/**
 * Log Analyzer
 *
 * Analyzes logs to extract patterns, anomalies, and evidence for hypotheses.
 * Uses both pattern matching and LLM summarization for comprehensive analysis.
 */

import type { LogAnalysis } from './llm-parser';
import { parseLogAnalysis, PROMPTS, fillPrompt } from './llm-parser';

/**
 * Common error patterns to detect in logs
 */
export const ERROR_PATTERNS = {
  // Connection issues
  connectionTimeout: {
    patterns: [
      /connection\s+timeout/i,
      /connect\s+ETIMEDOUT/i,
      /connection\s+refused/i,
      /ECONNREFUSED/i,
      /connection\s+reset/i,
      /ECONNRESET/i,
      /socket\s+hang\s+up/i,
    ],
    category: 'connectivity',
    severity: 'error' as const,
    hypothesis: 'Network or service connectivity issue',
  },

  // Memory issues
  outOfMemory: {
    patterns: [
      /out\s+of\s+memory/i,
      /OutOfMemoryError/i,
      /JavaScript\s+heap\s+out\s+of\s+memory/i,
      /ENOMEM/i,
      /memory\s+allocation\s+failed/i,
      /OOM\s+killer/i,
    ],
    category: 'resources',
    severity: 'critical' as const,
    hypothesis: 'Memory exhaustion causing service failure',
  },

  // Database issues
  databaseError: {
    patterns: [
      /deadlock/i,
      /lock\s+wait\s+timeout/i,
      /too\s+many\s+connections/i,
      /connection\s+pool\s+exhausted/i,
      /database\s+connection\s+failed/i,
      /query\s+timeout/i,
    ],
    category: 'database',
    severity: 'error' as const,
    hypothesis: 'Database connectivity or performance issue',
  },

  // Rate limiting
  rateLimiting: {
    patterns: [
      /rate\s+limit/i,
      /too\s+many\s+requests/i,
      /429\s+/,
      /throttl/i,
      /quota\s+exceeded/i,
    ],
    category: 'capacity',
    severity: 'warning' as const,
    hypothesis: 'Service being rate limited or throttled',
  },

  // Authentication issues
  authError: {
    patterns: [
      /unauthorized/i,
      /forbidden/i,
      /401\s+/,
      /403\s+/,
      /authentication\s+failed/i,
      /invalid\s+token/i,
      /expired\s+token/i,
      /access\s+denied/i,
    ],
    category: 'security',
    severity: 'warning' as const,
    hypothesis: 'Authentication or authorization failure',
  },

  // Service errors
  serviceError: {
    patterns: [
      /internal\s+server\s+error/i,
      /500\s+/,
      /502\s+/,
      /503\s+/,
      /504\s+/,
      /service\s+unavailable/i,
      /bad\s+gateway/i,
      /gateway\s+timeout/i,
    ],
    category: 'application',
    severity: 'error' as const,
    hypothesis: 'Service returning error responses',
  },

  // Disk issues
  diskError: {
    patterns: [
      /no\s+space\s+left/i,
      /disk\s+full/i,
      /ENOSPC/i,
      /read-only\s+file\s+system/i,
      /I\/O\s+error/i,
    ],
    category: 'resources',
    severity: 'critical' as const,
    hypothesis: 'Disk space or I/O issue',
  },

  // DNS issues
  dnsError: {
    patterns: [
      /ENOTFOUND/i,
      /DNS\s+resolution\s+failed/i,
      /getaddrinfo\s+ENOTFOUND/i,
      /name\s+or\s+service\s+not\s+known/i,
    ],
    category: 'connectivity',
    severity: 'error' as const,
    hypothesis: 'DNS resolution failure',
  },

  // SSL/TLS issues
  sslError: {
    patterns: [
      /certificate\s+has\s+expired/i,
      /certificate\s+verify\s+failed/i,
      /SSL\s+handshake\s+failed/i,
      /unable\s+to\s+verify\s+certificate/i,
      /self.signed\s+certificate/i,
    ],
    category: 'security',
    severity: 'error' as const,
    hypothesis: 'SSL/TLS certificate or handshake issue',
  },

  // Process crash
  processCrash: {
    patterns: [
      /segmentation\s+fault/i,
      /SIGSEGV/i,
      /SIGKILL/i,
      /SIGTERM/i,
      /process\s+exited/i,
      /uncaught\s+exception/i,
      /unhandled\s+rejection/i,
      /fatal\s+error/i,
    ],
    category: 'application',
    severity: 'critical' as const,
    hypothesis: 'Application crash or abnormal termination',
  },

  // Kubernetes specific
  kubernetes: {
    patterns: [
      /pod\s+evicted/i,
      /liveness\s+probe\s+failed/i,
      /readiness\s+probe\s+failed/i,
      /CrashLoopBackOff/i,
      /ImagePullBackOff/i,
      /ErrImagePull/i,
      /ContainerCreating/i,
      /Pending/,
    ],
    category: 'infrastructure',
    severity: 'error' as const,
    hypothesis: 'Kubernetes pod or container issue',
  },
};

/**
 * Pattern match result
 */
export interface PatternMatch {
  patternName: string;
  category: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  hypothesis: string;
  matchCount: number;
  examples: string[];
  firstSeen?: string;
  lastSeen?: string;
}

/**
 * Log entry with parsed structure
 */
export interface LogEntry {
  timestamp?: Date;
  level?: string;
  message: string;
  source?: string;
  raw: string;
}

/**
 * Log analysis result
 */
export interface LogAnalysisResult {
  totalLines: number;
  errorCount: number;
  warningCount: number;
  patternMatches: PatternMatch[];
  suggestedHypotheses: string[];
  timeRange?: {
    start: Date;
    end: Date;
  };
  serviceMentions: Map<string, number>;
  summary: string;
}

/**
 * Parse a log line to extract timestamp and level
 */
export function parseLogLine(line: string): LogEntry {
  // Try to parse common log formats

  // ISO timestamp format: 2024-01-01T10:00:00.000Z
  const isoMatch = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[\d.]*Z?)/);

  // Common log format: Jan 01 10:00:00
  const syslogMatch = line.match(/(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/);

  // Unix timestamp
  const unixMatch = line.match(/^(\d{10,13})\s/);

  let timestamp: Date | undefined;
  if (isoMatch) {
    timestamp = new Date(isoMatch[1]);
  } else if (syslogMatch) {
    // Assume current year for syslog format
    timestamp = new Date(`${syslogMatch[1]} ${new Date().getFullYear()}`);
  } else if (unixMatch) {
    const ts = parseInt(unixMatch[1], 10);
    timestamp = new Date(ts > 9999999999 ? ts : ts * 1000);
  }

  // Try to extract log level
  const levelMatch = line.match(/\b(DEBUG|INFO|WARN|WARNING|ERROR|CRITICAL|FATAL|TRACE)\b/i);
  const level = levelMatch ? levelMatch[1].toUpperCase() : undefined;

  // Extract source/service from common formats
  // e.g., [api-gateway] or <api-gateway> or api-gateway:
  const sourceMatch = line.match(/[\[<]([a-zA-Z0-9-_]+)[\]>]|^([a-zA-Z0-9-_]+):/);
  const source = sourceMatch ? (sourceMatch[1] || sourceMatch[2]) : undefined;

  return {
    timestamp,
    level,
    message: line,
    source,
    raw: line,
  };
}

/**
 * Analyze logs for patterns
 */
export function analyzePatterns(logs: string[]): PatternMatch[] {
  const matches = new Map<string, PatternMatch>();

  for (const log of logs) {
    const parsed = parseLogLine(log);

    for (const [name, pattern] of Object.entries(ERROR_PATTERNS)) {
      for (const regex of pattern.patterns) {
        if (regex.test(log)) {
          const existing = matches.get(name);
          if (existing) {
            existing.matchCount++;
            if (existing.examples.length < 3) {
              existing.examples.push(log.substring(0, 200));
            }
            if (parsed.timestamp) {
              if (!existing.firstSeen || parsed.timestamp.toISOString() < existing.firstSeen) {
                existing.firstSeen = parsed.timestamp.toISOString();
              }
              if (!existing.lastSeen || parsed.timestamp.toISOString() > existing.lastSeen) {
                existing.lastSeen = parsed.timestamp.toISOString();
              }
            }
          } else {
            matches.set(name, {
              patternName: name,
              category: pattern.category,
              severity: pattern.severity,
              hypothesis: pattern.hypothesis,
              matchCount: 1,
              examples: [log.substring(0, 200)],
              firstSeen: parsed.timestamp?.toISOString(),
              lastSeen: parsed.timestamp?.toISOString(),
            });
          }
          break; // Only match once per pattern group
        }
      }
    }
  }

  // Sort by severity and count
  const severityOrder = { critical: 0, error: 1, warning: 2, info: 3 };
  return Array.from(matches.values()).sort((a, b) => {
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return b.matchCount - a.matchCount;
  });
}

/**
 * Extract mentioned services from logs
 */
export function extractServiceMentions(logs: string[], knownServices: string[] = []): Map<string, number> {
  const mentions = new Map<string, number>();

  // Common service name patterns
  const servicePatterns = [
    /service[=:]\s*["']?([a-zA-Z0-9-_]+)["']?/gi,
    /host[=:]\s*["']?([a-zA-Z0-9-_.]+)["']?/gi,
    /app[=:]\s*["']?([a-zA-Z0-9-_]+)["']?/gi,
    /container[=:]\s*["']?([a-zA-Z0-9-_]+)["']?/gi,
  ];

  for (const log of logs) {
    // Check known services
    for (const service of knownServices) {
      if (log.toLowerCase().includes(service.toLowerCase())) {
        mentions.set(service, (mentions.get(service) || 0) + 1);
      }
    }

    // Extract from patterns
    for (const pattern of servicePatterns) {
      const matches = log.matchAll(pattern);
      for (const match of matches) {
        const service = match[1];
        mentions.set(service, (mentions.get(service) || 0) + 1);
      }
    }

    // Extract from parsed line
    const parsed = parseLogLine(log);
    if (parsed.source) {
      mentions.set(parsed.source, (mentions.get(parsed.source) || 0) + 1);
    }
  }

  return mentions;
}

/**
 * Get time range from logs
 */
export function getTimeRange(logs: string[]): { start: Date; end: Date } | undefined {
  let start: Date | undefined;
  let end: Date | undefined;

  for (const log of logs) {
    const parsed = parseLogLine(log);
    if (parsed.timestamp) {
      if (!start || parsed.timestamp < start) {
        start = parsed.timestamp;
      }
      if (!end || parsed.timestamp > end) {
        end = parsed.timestamp;
      }
    }
  }

  if (start && end) {
    return { start, end };
  }
  return undefined;
}

/**
 * Count errors and warnings
 */
export function countByLevel(logs: string[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;

  for (const log of logs) {
    const parsed = parseLogLine(log);
    if (parsed.level === 'ERROR' || parsed.level === 'CRITICAL' || parsed.level === 'FATAL') {
      errors++;
    } else if (parsed.level === 'WARN' || parsed.level === 'WARNING') {
      warnings++;
    }
  }

  return { errors, warnings };
}

/**
 * Generate hypotheses from pattern matches
 */
export function generateHypothesesFromPatterns(matches: PatternMatch[]): string[] {
  const hypotheses: string[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    if (!seen.has(match.hypothesis)) {
      seen.add(match.hypothesis);
      hypotheses.push(match.hypothesis);
    }
  }

  return hypotheses;
}

/**
 * Generate a summary from log analysis
 */
export function generateSummary(result: Omit<LogAnalysisResult, 'summary'>): string {
  const lines: string[] = [];

  lines.push(`Analyzed ${result.totalLines} log lines.`);

  if (result.errorCount > 0 || result.warningCount > 0) {
    lines.push(`Found ${result.errorCount} errors and ${result.warningCount} warnings.`);
  }

  if (result.timeRange) {
    lines.push(`Time range: ${result.timeRange.start.toISOString()} to ${result.timeRange.end.toISOString()}`);
  }

  if (result.patternMatches.length > 0) {
    const critical = result.patternMatches.filter((m) => m.severity === 'critical');
    const errors = result.patternMatches.filter((m) => m.severity === 'error');

    if (critical.length > 0) {
      lines.push(`Critical issues detected: ${critical.map((m) => m.patternName).join(', ')}`);
    }
    if (errors.length > 0) {
      lines.push(`Error patterns found: ${errors.map((m) => m.patternName).join(', ')}`);
    }
  }

  if (result.serviceMentions.size > 0) {
    const topServices = Array.from(result.serviceMentions.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);
    lines.push(`Services mentioned: ${topServices.join(', ')}`);
  }

  return lines.join(' ');
}

/**
 * Analyze logs without LLM
 */
export function analyzeLogs(logs: string[], knownServices: string[] = []): LogAnalysisResult {
  const patternMatches = analyzePatterns(logs);
  const serviceMentions = extractServiceMentions(logs, knownServices);
  const timeRange = getTimeRange(logs);
  const { errors, warnings } = countByLevel(logs);
  const suggestedHypotheses = generateHypothesesFromPatterns(patternMatches);

  const result = {
    totalLines: logs.length,
    errorCount: errors,
    warningCount: warnings,
    patternMatches,
    suggestedHypotheses,
    timeRange,
    serviceMentions,
    summary: '',
  };

  result.summary = generateSummary(result);

  return result;
}

/**
 * Format logs for LLM analysis
 */
export function formatLogsForLLM(logs: string[], maxLines: number = 100): string {
  // Sample logs if too many
  let sampled = logs;
  if (logs.length > maxLines) {
    // Take first, middle, and last portions
    const third = Math.floor(maxLines / 3);
    sampled = [
      ...logs.slice(0, third),
      `... (${logs.length - maxLines} lines omitted) ...`,
      ...logs.slice(Math.floor(logs.length / 2) - Math.floor(third / 2), Math.floor(logs.length / 2) + Math.floor(third / 2)),
      ...logs.slice(-third),
    ];
  }

  return sampled.join('\n');
}

/**
 * Create prompt for LLM log analysis
 */
export function createLogAnalysisPrompt(logs: string[], startTime?: string, endTime?: string): string {
  const formattedLogs = formatLogsForLLM(logs);
  const start = startTime || 'unknown';
  const end = endTime || 'unknown';

  return fillPrompt(PROMPTS.analyzeLogs, {
    logs: formattedLogs,
    startTime: start,
    endTime: end,
  });
}

/**
 * Merge pattern analysis with LLM analysis
 */
export function mergeAnalysis(patternResult: LogAnalysisResult, llmResult: LogAnalysis): LogAnalysisResult {
  // Combine hypotheses, deduplicating
  const allHypotheses = new Set([
    ...patternResult.suggestedHypotheses,
    ...llmResult.suggestedHypotheses,
  ]);

  // Merge pattern matches
  const mergedPatterns = [...patternResult.patternMatches];

  // Add LLM-discovered patterns if not already found
  for (const llmPattern of llmResult.patterns) {
    const exists = mergedPatterns.some(
      (p) => p.patternName.toLowerCase() === llmPattern.pattern.toLowerCase()
    );
    if (!exists) {
      mergedPatterns.push({
        patternName: llmPattern.pattern,
        category: 'llm-detected',
        severity: llmPattern.severity,
        hypothesis: `Pattern detected: ${llmPattern.pattern}`,
        matchCount: llmPattern.count,
        examples: llmPattern.examples,
        firstSeen: llmPattern.firstSeen,
        lastSeen: llmPattern.lastSeen,
      });
    }
  }

  return {
    ...patternResult,
    patternMatches: mergedPatterns,
    suggestedHypotheses: Array.from(allHypotheses),
    summary: llmResult.summary || patternResult.summary,
  };
}

/**
 * Filter logs by time window
 */
export function filterLogsByTime(logs: string[], start: Date, end: Date): string[] {
  return logs.filter((log) => {
    const parsed = parseLogLine(log);
    if (!parsed.timestamp) return true; // Include logs without timestamps
    return parsed.timestamp >= start && parsed.timestamp <= end;
  });
}

/**
 * Filter logs by level
 */
export function filterLogsByLevel(logs: string[], minLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL'): string[] {
  const levelOrder = { DEBUG: 0, TRACE: 0, INFO: 1, WARN: 2, WARNING: 2, ERROR: 3, CRITICAL: 4, FATAL: 4 };
  const minOrder = levelOrder[minLevel];

  return logs.filter((log) => {
    const parsed = parseLogLine(log);
    if (!parsed.level) return true; // Include logs without level
    const logOrder = levelOrder[parsed.level as keyof typeof levelOrder] ?? 1;
    return logOrder >= minOrder;
  });
}

/**
 * Search logs for specific patterns
 */
export function searchLogs(logs: string[], query: string | RegExp): string[] {
  const pattern = typeof query === 'string' ? new RegExp(query, 'i') : query;
  return logs.filter((log) => pattern.test(log));
}
