/**
 * Claude Hook Handlers with Context Injection
 *
 * Handles Claude Code hook events and returns relevant context
 * to enhance Claude's knowledge during investigations.
 */

import { existsSync } from 'fs';
import { readFile, writeFile, mkdir, appendFile } from 'fs/promises';
import { join, resolve } from 'path';
import { createConfiguredRetriever, KnowledgeRetriever } from '../knowledge/retriever/index';
import type { RetrievedKnowledge, RetrievedChunk } from '../knowledge/types';
import { createCheckpoint, createCheckpointStore } from '../session';

/**
 * Hook response that can be returned to Claude Code
 */
export interface HookResponse {
  /** System message to inject into Claude's context */
  systemMessage?: string;
  /** Whether to continue processing (for PreToolUse) */
  continue?: boolean;
  /** Reason for blocking (for PreToolUse) */
  stopReason?: string;
}

/**
 * Parsed hook payload from Claude Code
 */
export interface HookPayload {
  session_id: string;
  hook_event_name: string;
  cwd?: string;
  prompt?: string;
  transcript_path?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: unknown;
}

/**
 * Active incident from PagerDuty/OpsGenie
 */
export interface ActiveIncident {
  id: string;
  title: string;
  severity: 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
  status: 'triggered' | 'acknowledged' | 'resolved';
  service: string;
  createdAt: string;
  url?: string;
}

/**
 * Session state for tracking investigations
 */
export interface SessionState {
  sessionId: string;
  investigationId?: string;
  startedAt: string;
  lastPrompt?: string;
  servicesDiscovered: string[];
  symptomsDiscovered: string[];
  promptCount: number;
  toolCallCount: number;
  lastToolName?: string;
  stoppedAt?: string;
  lastCheckpointId?: string;
}

/**
 * Configuration for hook handlers
 */
export interface HookHandlerConfig {
  baseDir: string;
  enableKnowledgeInjection: boolean;
  enableIncidentDetection: boolean;
  maxRunbooksToShow: number;
  maxKnownIssuesToShow: number;
}

const DEFAULT_CONFIG: HookHandlerConfig = {
  baseDir: '.runbook',
  enableKnowledgeInjection: true,
  enableIncidentDetection: true,
  maxRunbooksToShow: 3,
  maxKnownIssuesToShow: 3,
};
const RETRIEVER_IDLE_TTL_MS = 2 * 60 * 1000;

interface CachedRetriever {
  retriever: KnowledgeRetriever;
  lastUsedAt: number;
}

const retrieverCache = new Map<string, CachedRetriever>();

function normalizeBaseDir(baseDir: string): string {
  return resolve(baseDir);
}

function touchRetriever(baseDir: string): void {
  const key = normalizeBaseDir(baseDir);
  const cached = retrieverCache.get(key);
  if (cached) {
    cached.lastUsedAt = Date.now();
  }
}

function pruneRetrieverCache(): void {
  const now = Date.now();
  for (const [key, cached] of retrieverCache.entries()) {
    if (now - cached.lastUsedAt <= RETRIEVER_IDLE_TTL_MS) {
      continue;
    }
    cached.retriever.close();
    retrieverCache.delete(key);
  }
}

async function getCachedRetriever(baseDir: string): Promise<KnowledgeRetriever> {
  pruneRetrieverCache();
  const key = normalizeBaseDir(baseDir);
  const cached = retrieverCache.get(key);
  if (cached) {
    cached.lastUsedAt = Date.now();
    return cached.retriever;
  }

  const retriever = await createConfiguredRetriever(baseDir);
  retrieverCache.set(key, {
    retriever,
    lastUsedAt: Date.now(),
  });
  return retriever;
}

export function clearHookHandlerRetrieverCache(): void {
  for (const cached of retrieverCache.values()) {
    cached.retriever.close();
  }
  retrieverCache.clear();
}

interface ToolEventRecord {
  timestamp: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResultSummary?: string;
}

/**
 * Extract services mentioned in a prompt
 */
function extractServices(prompt: string): string[] {
  const services: string[] = [];

  // Common service name patterns
  const patterns = [
    /(\w+)-service/gi,
    /(\w+)[-_]api/gi,
    /(\w+)[-_]worker/gi,
    /(\w+)[-_]gateway/gi,
    /service[:\s]+["']?(\w+)["']?/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(prompt)) !== null) {
      const serviceName = match[1].toLowerCase();
      if (!services.includes(serviceName) && serviceName.length > 2) {
        services.push(serviceName);
      }
    }
  }

  return services;
}

/**
 * Extract symptoms from a prompt
 */
function extractSymptoms(prompt: string): string[] {
  const symptoms: string[] = [];
  const lower = prompt.toLowerCase();

  const symptomKeywords = [
    { pattern: /500\s*error/i, symptom: 'HTTP 500 errors' },
    { pattern: /502\s*(bad\s*gateway)?/i, symptom: 'HTTP 502 Bad Gateway' },
    { pattern: /503\s*(service\s*unavailable)?/i, symptom: 'HTTP 503 Service Unavailable' },
    { pattern: /504\s*(gateway\s*timeout)?/i, symptom: 'HTTP 504 Gateway Timeout' },
    { pattern: /timeout/i, symptom: 'Timeouts' },
    { pattern: /slow|latency|lag/i, symptom: 'High latency' },
    { pattern: /memory\s*(leak|spike|high|oom)/i, symptom: 'Memory issues' },
    { pattern: /cpu\s*(spike|high|100)/i, symptom: 'High CPU usage' },
    { pattern: /connection\s*(pool|refused|reset)/i, symptom: 'Connection issues' },
    { pattern: /disk\s*(full|space)/i, symptom: 'Disk space issues' },
    { pattern: /crash|restart|oom/i, symptom: 'Service crashes' },
    { pattern: /queue\s*(full|backed\s*up|lag)/i, symptom: 'Queue backlog' },
  ];

  for (const { pattern, symptom } of symptomKeywords) {
    if (pattern.test(lower) && !symptoms.includes(symptom)) {
      symptoms.push(symptom);
    }
  }

  return symptoms;
}

/**
 * Format runbooks for system message
 */
function formatRunbooks(runbooks: RetrievedChunk[], max: number): string {
  if (runbooks.length === 0) return '';

  const lines: string[] = ['### Relevant Runbooks'];
  for (const rb of runbooks.slice(0, max)) {
    const score = Math.round(rb.score * 100);
    lines.push(`- **${rb.title}** (${score}% match)`);
    lines.push(`  Services: ${rb.services.join(', ') || 'general'}`);
    // Show first 200 chars of content
    const preview = rb.content.slice(0, 200).replace(/\n/g, ' ').trim();
    if (preview) {
      lines.push(`  Preview: ${preview}...`);
    }
  }
  return lines.join('\n');
}

/**
 * Format known issues for system message
 */
function formatKnownIssues(issues: RetrievedChunk[], max: number): string {
  if (issues.length === 0) return '';

  const lines: string[] = ['### Active Known Issues'];
  for (const issue of issues.slice(0, max)) {
    lines.push(`- ⚠️ **${issue.title}**`);
    lines.push(`  Services: ${issue.services.join(', ')}`);
    const preview = issue.content.slice(0, 150).replace(/\n/g, ' ').trim();
    if (preview) {
      lines.push(`  ${preview}...`);
    }
  }
  return lines.join('\n');
}

/**
 * Format postmortems for system message
 */
function formatPostmortems(postmortems: RetrievedChunk[], max: number): string {
  if (postmortems.length === 0) return '';

  const lines: string[] = ['### Similar Past Incidents'];
  for (const pm of postmortems.slice(0, max)) {
    lines.push(`- **${pm.title}**`);
    lines.push(`  Services: ${pm.services.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * Format active incidents for system message
 */
function formatActiveIncidents(incidents: ActiveIncident[]): string {
  if (incidents.length === 0) return '';

  const lines: string[] = ['### 🚨 Active Incidents'];
  for (const incident of incidents) {
    const status = incident.status === 'triggered' ? '🔴' : '🟡';
    lines.push(`- ${status} **[${incident.severity}] ${incident.title}**`);
    lines.push(`  Service: ${incident.service} | Status: ${incident.status}`);
    if (incident.url) {
      lines.push(`  Link: ${incident.url}`);
    }
  }
  return lines.join('\n');
}

/**
 * Load session state from disk
 */
async function loadSessionState(baseDir: string, sessionId: string): Promise<SessionState | null> {
  const sessionFile = join(baseDir, 'sessions', `${sessionId}.json`);
  if (!existsSync(sessionFile)) {
    return null;
  }

  try {
    const content = await readFile(sessionFile, 'utf-8');
    return JSON.parse(content) as SessionState;
  } catch {
    return null;
  }
}

/**
 * Save session state to disk
 */
async function saveSessionState(baseDir: string, state: SessionState): Promise<void> {
  const sessionDir = join(baseDir, 'sessions');
  await mkdir(sessionDir, { recursive: true });

  const sessionFile = join(sessionDir, `${state.sessionId}.json`);
  await writeFile(sessionFile, JSON.stringify(state, null, 2), 'utf-8');
}

function createDefaultSessionState(sessionId: string): SessionState {
  return {
    sessionId,
    startedAt: new Date().toISOString(),
    servicesDiscovered: [],
    symptomsDiscovered: [],
    promptCount: 0,
    toolCallCount: 0,
  };
}

async function getOrCreateSessionState(baseDir: string, sessionId: string): Promise<SessionState> {
  const existing = await loadSessionState(baseDir, sessionId);
  if (existing) {
    return {
      ...existing,
      symptomsDiscovered: existing.symptomsDiscovered || [],
      toolCallCount: existing.toolCallCount || 0,
    };
  }
  return createDefaultSessionState(sessionId);
}

function summarizeToolResult(result: unknown, maxLen = 1200): string | undefined {
  if (result === null || result === undefined) {
    return undefined;
  }
  if (typeof result === 'string') {
    return result.length > maxLen ? `${result.slice(0, maxLen)}...` : result;
  }
  try {
    const serialized = JSON.stringify(result);
    return serialized.length > maxLen ? `${serialized.slice(0, maxLen)}...` : serialized;
  } catch {
    return String(result);
  }
}

async function appendToolEvent(baseDir: string, event: ToolEventRecord): Promise<void> {
  const sessionDir = join(baseDir, 'sessions');
  await mkdir(sessionDir, { recursive: true });
  const eventsPath = join(sessionDir, `${event.sessionId}.tools.jsonl`);
  await appendFile(eventsPath, `${JSON.stringify(event)}\n`, 'utf-8');
}

/**
 * Hook handler for SessionStart events
 */
export async function handleSessionStart(
  payload: HookPayload,
  config: HookHandlerConfig = DEFAULT_CONFIG
): Promise<HookResponse> {
  const state = createDefaultSessionState(payload.session_id);

  await saveSessionState(config.baseDir, state);

  // Get knowledge stats
  let knowledgeStats = '';

  try {
    const retriever = await getCachedRetriever(config.baseDir);
    const counts = retriever.getDocumentCountsByType();
    const total = Object.values(counts).reduce((sum, c) => sum + c, 0);

    if (total > 0) {
      knowledgeStats = `\n\n📚 **RunbookAI Knowledge Available:**
- Runbooks: ${counts.runbook || 0}
- Postmortems: ${counts.postmortem || 0}
- Known Issues: ${counts.known_issue || 0}
- Architecture Docs: ${counts.architecture || 0}`;
    }
  } catch {
    // Knowledge not available, that's ok
  } finally {
    touchRetriever(config.baseDir);
  }

  return {
    systemMessage: `🔗 RunbookAI session linked. Investigation context will be automatically provided.${knowledgeStats}`,
  };
}

/**
 * Hook handler for UserPromptSubmit events
 * This is the main context injection point
 */
export async function handleUserPromptSubmit(
  payload: HookPayload,
  config: HookHandlerConfig = DEFAULT_CONFIG
): Promise<HookResponse> {
  if (!payload.prompt) {
    return {};
  }

  // Extract entities from prompt
  const services = extractServices(payload.prompt);
  const symptoms = extractSymptoms(payload.prompt);

  // Update session state
  const state = await getOrCreateSessionState(config.baseDir, payload.session_id);

  state.lastPrompt = payload.prompt;
  state.promptCount++;
  state.servicesDiscovered = [...new Set([...state.servicesDiscovered, ...services])];
  state.symptomsDiscovered = [...new Set([...state.symptomsDiscovered, ...symptoms])];
  await saveSessionState(config.baseDir, state);

  // Skip context injection if disabled
  if (!config.enableKnowledgeInjection) {
    return {};
  }

  // Build search query from prompt + symptoms
  const searchQuery = [payload.prompt, ...symptoms].join(' ');

  // Retrieve relevant knowledge
  let knowledge: RetrievedKnowledge | null = null;

  try {
    const retriever = await getCachedRetriever(config.baseDir);
    knowledge = await retriever.search(searchQuery, {
      serviceFilter: services.length > 0 ? services : undefined,
      limit: 10,
    });
  } catch {
    // Knowledge retrieval failed, continue without
  } finally {
    touchRetriever(config.baseDir);
  }

  // Build system message
  const sections: string[] = ['## RunbookAI Context\n'];

  // Add symptoms detected
  if (symptoms.length > 0) {
    sections.push(`**Detected Symptoms:** ${symptoms.join(', ')}\n`);
  }

  // Add services detected
  if (services.length > 0) {
    sections.push(`**Services Mentioned:** ${services.join(', ')}\n`);
  }

  // Add knowledge sections
  if (knowledge) {
    const runbooksSection = formatRunbooks(knowledge.runbooks, config.maxRunbooksToShow);
    const issuesSection = formatKnownIssues(knowledge.knownIssues, config.maxKnownIssuesToShow);
    const postmortemsSection = formatPostmortems(knowledge.postmortems, 2);

    if (runbooksSection) sections.push(runbooksSection);
    if (issuesSection) sections.push(issuesSection);
    if (postmortemsSection) sections.push(postmortemsSection);
  }

  // Only return if we have meaningful context
  if (sections.length <= 1) {
    return {};
  }

  sections.push('\n---\n_Use this knowledge to inform your investigation._');

  return {
    systemMessage: sections.join('\n'),
  };
}

/**
 * Hook handler for PreToolUse events
 * Can block dangerous operations
 */
export async function handlePreToolUse(
  payload: HookPayload,
  config: HookHandlerConfig = DEFAULT_CONFIG
): Promise<HookResponse> {
  const toolName = payload.tool_name || '';
  const toolInput = payload.tool_input || {};

  // List of mutation tools that require extra caution
  const mutationTools = [
    'Bash', // Could execute anything
    'Write', // Could overwrite files
    'Edit', // Could modify files
  ];

  // Check for dangerous patterns in Bash commands
  if (toolName === 'Bash' && typeof toolInput.command === 'string') {
    const command = toolInput.command.toLowerCase();

    // Block obviously dangerous commands in production contexts
    const dangerousPatterns = [
      /rm\s+-rf\s+\//,
      /kubectl\s+delete\s+(deployment|pod|service)/,
      /aws\s+(ec2|ecs|rds)\s+(terminate|delete|stop)/,
      /docker\s+(rm|stop|kill)\s+-f/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return {
          continue: false,
          stopReason: `⚠️ RunbookAI blocked potentially dangerous command. Use 'runbook approve' to proceed with mutations.`,
        };
      }
    }
  }

  return { continue: true };
}

/**
 * Hook handler for PostToolUse events
 * Can track tool usage for learning
 */
export async function handlePostToolUse(
  payload: HookPayload,
  config: HookHandlerConfig = DEFAULT_CONFIG
): Promise<HookResponse> {
  const toolName = payload.tool_name || 'unknown';
  const toolInput = payload.tool_input || {};

  try {
    const state = await getOrCreateSessionState(config.baseDir, payload.session_id);
    state.toolCallCount++;
    state.lastToolName = toolName;

    if (typeof toolInput.command === 'string') {
      const servicesFromCommand = extractServices(toolInput.command);
      state.servicesDiscovered = [
        ...new Set([...state.servicesDiscovered, ...servicesFromCommand]),
      ];
    }

    await saveSessionState(config.baseDir, state);
    await appendToolEvent(config.baseDir, {
      timestamp: new Date().toISOString(),
      sessionId: payload.session_id,
      toolName,
      toolInput,
      toolResultSummary: summarizeToolResult(payload.tool_result),
    });
  } catch {
    // Keep hook pipeline non-blocking.
  }

  return {};
}

/**
 * Hook handler for Stop events
 * Create checkpoints and trigger learning
 */
export async function handleStop(
  payload: HookPayload,
  config: HookHandlerConfig = DEFAULT_CONFIG
): Promise<HookResponse> {
  // Load session state
  const state = await loadSessionState(config.baseDir, payload.session_id);
  if (!state) {
    return {};
  }

  try {
    const investigationId = state.investigationId || `claude-session-${payload.session_id}`;
    const store = createCheckpointStore({ baseDir: config.baseDir });
    const checkpoint = createCheckpoint(
      investigationId,
      {
        query: state.lastPrompt || `Claude session ${payload.session_id}`,
        phase: 'complete',
        hypotheses: [],
        confidence: 0,
        toolCallCount: state.toolCallCount || 0,
        servicesDiscovered: state.servicesDiscovered,
        symptomsIdentified: state.symptomsDiscovered || [],
      },
      payload.session_id
    );
    const checkpointId = await store.save(checkpoint);

    state.investigationId = investigationId;
    state.stoppedAt = new Date().toISOString();
    state.lastCheckpointId = checkpointId;
    await saveSessionState(config.baseDir, state);
  } catch {
    // Keep hook pipeline non-blocking.
  }

  return {};
}

/**
 * Main hook handler that routes to specific handlers
 */
export async function handleHookEvent(
  payload: HookPayload,
  config: Partial<HookHandlerConfig> = {}
): Promise<HookResponse> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  switch (payload.hook_event_name) {
    case 'SessionStart':
      return handleSessionStart(payload, fullConfig);
    case 'UserPromptSubmit':
      return handleUserPromptSubmit(payload, fullConfig);
    case 'PreToolUse':
      return handlePreToolUse(payload, fullConfig);
    case 'PostToolUse':
      return handlePostToolUse(payload, fullConfig);
    case 'Stop':
    case 'SubagentStop':
      return handleStop(payload, fullConfig);
    default:
      return {};
  }
}

/**
 * Parse and handle hook input from stdin, returning JSON response
 */
export async function handleHookStdinWithResponse(
  input: string,
  config: Partial<HookHandlerConfig> = {}
): Promise<{ handled: boolean; response?: HookResponse; error?: string }> {
  if (!input || input.trim().length === 0) {
    return { handled: false, error: 'empty_stdin' };
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(input) as HookPayload;
  } catch (error) {
    return {
      handled: false,
      error: `invalid_json: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  try {
    const response = await handleHookEvent(payload, config);
    return { handled: true, response };
  } catch (error) {
    return {
      handled: false,
      error: `handler_error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
