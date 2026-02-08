/**
 * Investigation Memory
 *
 * Structured note-taking that survives context clearing.
 * Integrates with hypothesis engine for investigation-aware memory.
 */

import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import type { EvidenceStrength, ConfidenceLevel, Hypothesis } from './types';

/**
 * Types of findings the agent can record during investigation.
 */
export type FindingType =
  | 'symptom'
  | 'evidence'
  | 'hypothesis_update'
  | 'root_cause_candidate'
  | 'remediation_step'
  | 'escalation'
  | 'service_impact';

/**
 * A structured note from the investigation.
 */
export interface InvestigationNote {
  /** Unique identifier for the note */
  id: string;
  /** Type of finding */
  type: FindingType;
  /** The actual content of the finding */
  content: string;
  /** Confidence level in this finding */
  confidence: ConfidenceLevel;
  /** Evidence strength if applicable */
  evidenceStrength?: EvidenceStrength;
  /** Result IDs that support this finding */
  sourceResultIds: string[];
  /** Services involved in this finding */
  servicesInvolved: string[];
  /** Related hypothesis ID if applicable */
  hypothesisId?: string;
  /** Timestamp when the note was created */
  timestamp: string;
  /** Iteration number when this was discovered */
  iteration: number;
}

/**
 * Overall state of the investigation.
 */
export interface InvestigationState {
  /** Original user query */
  query: string;
  /** Incident ID if investigating an incident */
  incidentId?: string;
  /** Session ID for persistence */
  sessionId: string;
  /** All investigation notes */
  notes: InvestigationNote[];
  /** High-level progress summary */
  progressSummary: string;
  /** Services discovered during investigation */
  servicesDiscovered: string[];
  /** Symptoms identified during investigation */
  symptomsIdentified: string[];
  /** Current active hypotheses (IDs) */
  activeHypotheses: string[];
  /** Pruned hypotheses (IDs) */
  prunedHypotheses: string[];
  /** Confirmed root cause if found */
  confirmedRootCause?: {
    hypothesis: string;
    confidence: ConfidenceLevel;
    evidence: string[];
  };
  /** Current iteration */
  currentIteration: number;
  /** Timestamp when investigation started */
  startedAt: string;
  /** Last update timestamp */
  lastUpdatedAt: string;
}

/**
 * Configuration for finding extraction.
 */
export interface ExtractionConfig {
  /** Keywords that suggest a symptom */
  symptomKeywords: string[];
  /** Keywords that suggest evidence */
  evidenceKeywords: string[];
  /** Keywords that suggest root cause */
  rootCauseKeywords: string[];
  /** Patterns for service name extraction */
  servicePatterns: RegExp[];
}

const DEFAULT_EXTRACTION_CONFIG: ExtractionConfig = {
  symptomKeywords: ['error', 'failed', 'timeout', 'latency', 'spike', 'dropped', 'unavailable', 'unhealthy', 'alarm', 'alert'],
  evidenceKeywords: ['found', 'discovered', 'shows', 'indicates', 'reveals', 'observed', 'detected', 'correlates', 'matches'],
  rootCauseKeywords: ['root cause', 'caused by', 'due to', 'because', 'resulted from', 'triggered by', 'originated from'],
  servicePatterns: [
    /service[:\s]+([a-zA-Z0-9_-]+)/gi,
    /([a-zA-Z0-9_-]+)-service/gi,
    /cluster[:\s]+([a-zA-Z0-9_-]+)/gi,
    /function[:\s]+([a-zA-Z0-9_-]+)/gi,
    /\b(api|auth|payment|user|order|inventory|notification|gateway)[a-zA-Z0-9_-]*/gi,
  ],
};

/**
 * InvestigationMemory manages structured notes for an investigation.
 */
export class InvestigationMemory {
  private readonly investigationDir: string;
  private readonly filepath: string;
  private state: InvestigationState;
  private readonly extractionConfig: ExtractionConfig;

  constructor(
    query: string,
    options: {
      incidentId?: string;
      sessionId?: string;
      baseDir?: string;
    } = {}
  ) {
    this.extractionConfig = DEFAULT_EXTRACTION_CONFIG;
    this.investigationDir = join(options.baseDir || '.runbook', 'investigations');

    // Generate session ID if not provided
    const sid = options.sessionId || this.generateSessionId(query);
    this.filepath = join(this.investigationDir, `${sid}.json`);

    // Initialize state
    this.state = {
      query,
      incidentId: options.incidentId,
      sessionId: sid,
      notes: [],
      progressSummary: 'Investigation started.',
      servicesDiscovered: [],
      symptomsIdentified: [],
      activeHypotheses: [],
      prunedHypotheses: [],
      currentIteration: 0,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  /**
   * Generate a unique session ID from the query.
   */
  private generateSessionId(query: string): string {
    const hash = createHash('md5').update(query).digest('hex').slice(0, 8);
    const now = new Date();
    const timestamp = now.toISOString().slice(0, 10).replace(/-/g, '');
    return `inv-${timestamp}-${hash}`;
  }

  /**
   * Initialize the memory (create directory, load existing state).
   */
  async init(): Promise<void> {
    // Ensure directory exists
    if (!existsSync(this.investigationDir)) {
      await mkdir(this.investigationDir, { recursive: true });
    }

    // Try to load existing state
    if (existsSync(this.filepath)) {
      try {
        const saved = JSON.parse(await readFile(this.filepath, 'utf-8'));
        this.state = saved;
      } catch {
        // Ignore parse errors, use fresh state
      }
    }
  }

  /**
   * Save current state to disk.
   */
  async save(): Promise<void> {
    if (!existsSync(this.investigationDir)) {
      await mkdir(this.investigationDir, { recursive: true });
    }
    await writeFile(this.filepath, JSON.stringify(this.state, null, 2));
  }

  /**
   * Add a structured note to the investigation.
   */
  addNote(
    type: FindingType,
    content: string,
    options: {
      confidence?: ConfidenceLevel;
      evidenceStrength?: EvidenceStrength;
      sourceResultIds?: string[];
      servicesInvolved?: string[];
      hypothesisId?: string;
    } = {}
  ): InvestigationNote {
    const note: InvestigationNote = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      content,
      confidence: options.confidence || 'medium',
      evidenceStrength: options.evidenceStrength,
      sourceResultIds: options.sourceResultIds || [],
      servicesInvolved: options.servicesInvolved || [],
      hypothesisId: options.hypothesisId,
      timestamp: new Date().toISOString(),
      iteration: this.state.currentIteration,
    };

    this.state.notes.push(note);
    this.state.lastUpdatedAt = note.timestamp;

    // Auto-update services discovered
    if (note.servicesInvolved.length > 0) {
      const newServices = note.servicesInvolved.filter(
        s => !this.state.servicesDiscovered.includes(s)
      );
      this.state.servicesDiscovered.push(...newServices);
    }

    return note;
  }

  /**
   * Record a symptom identified during investigation.
   */
  addSymptom(
    symptom: string,
    options: {
      sourceResultId?: string;
      services?: string[];
    } = {}
  ): InvestigationNote {
    if (!this.state.symptomsIdentified.includes(symptom)) {
      this.state.symptomsIdentified.push(symptom);
    }

    return this.addNote('symptom', symptom, {
      confidence: 'high',
      sourceResultIds: options.sourceResultId ? [options.sourceResultId] : [],
      servicesInvolved: options.services || [],
    });
  }

  /**
   * Record evidence for a hypothesis.
   */
  addEvidence(
    hypothesisId: string,
    evidence: string,
    strength: EvidenceStrength,
    options: {
      sourceResultId?: string;
      services?: string[];
    } = {}
  ): InvestigationNote {
    return this.addNote('evidence', evidence, {
      confidence: strength === 'strong' ? 'high' : strength === 'weak' ? 'low' : 'medium',
      evidenceStrength: strength,
      sourceResultIds: options.sourceResultId ? [options.sourceResultId] : [],
      servicesInvolved: options.services || [],
      hypothesisId,
    });
  }

  /**
   * Record a hypothesis update (formed, pruned, or confirmed).
   */
  addHypothesisUpdate(
    hypothesis: Hypothesis,
    action: 'formed' | 'pruned' | 'confirmed',
    reasoning?: string
  ): InvestigationNote {
    if (action === 'formed' || action === 'confirmed') {
      if (!this.state.activeHypotheses.includes(hypothesis.id)) {
        this.state.activeHypotheses.push(hypothesis.id);
      }
    }

    if (action === 'pruned') {
      this.state.activeHypotheses = this.state.activeHypotheses.filter(
        id => id !== hypothesis.id
      );
      if (!this.state.prunedHypotheses.includes(hypothesis.id)) {
        this.state.prunedHypotheses.push(hypothesis.id);
      }
    }

    if (action === 'confirmed') {
      this.state.confirmedRootCause = {
        hypothesis: hypothesis.statement,
        confidence: 'high',
        evidence: this.state.notes
          .filter(n => n.hypothesisId === hypothesis.id && n.type === 'evidence')
          .map(n => n.content),
      };
    }

    const content = `Hypothesis ${hypothesis.id} ${action}: ${hypothesis.statement}${reasoning ? `. Reasoning: ${reasoning}` : ''}`;

    return this.addNote('hypothesis_update', content, {
      confidence: action === 'confirmed' ? 'high' : 'medium',
      hypothesisId: hypothesis.id,
    });
  }

  /**
   * Record a root cause candidate.
   */
  addRootCauseCandidate(
    cause: string,
    confidence: ConfidenceLevel,
    options: {
      hypothesisId?: string;
      evidence?: string[];
      services?: string[];
    } = {}
  ): InvestigationNote {
    return this.addNote('root_cause_candidate', cause, {
      confidence,
      hypothesisId: options.hypothesisId,
      servicesInvolved: options.services || [],
      sourceResultIds: [],
    });
  }

  /**
   * Record service impact discovered.
   */
  addServiceImpact(
    service: string,
    impact: string,
    options: {
      sourceResultId?: string;
      severity?: 'critical' | 'degraded' | 'minor';
    } = {}
  ): InvestigationNote {
    if (!this.state.servicesDiscovered.includes(service)) {
      this.state.servicesDiscovered.push(service);
    }

    const content = `Service ${service}: ${impact}${options.severity ? ` (${options.severity})` : ''}`;

    return this.addNote('service_impact', content, {
      confidence: 'high',
      sourceResultIds: options.sourceResultId ? [options.sourceResultId] : [],
      servicesInvolved: [service],
    });
  }

  /**
   * Extract findings from LLM thinking/reasoning text.
   */
  extractFromThinking(thinkingText: string, resultId?: string): InvestigationNote[] {
    const notes: InvestigationNote[] = [];
    const sentences = thinkingText.split(/[.!?]+/).filter(s => s.trim().length > 15);

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      const lower = trimmed.toLowerCase();

      // Extract services mentioned
      const services: string[] = [];
      for (const pattern of this.extractionConfig.servicePatterns) {
        const matches = trimmed.matchAll(pattern);
        for (const match of matches) {
          if (match[1] && match[1].length > 2) {
            services.push(match[1]);
          }
        }
      }

      // Determine type based on keywords
      let type: FindingType = 'evidence';
      let confidence: ConfidenceLevel = 'medium';

      if (this.extractionConfig.rootCauseKeywords.some(kw => lower.includes(kw))) {
        type = 'root_cause_candidate';
        confidence = 'high';
      } else if (this.extractionConfig.symptomKeywords.some(kw => lower.includes(kw))) {
        type = 'symptom';
        confidence = 'high';
        // Add to symptoms list
        const symptomSummary = trimmed.slice(0, 100);
        if (!this.state.symptomsIdentified.some(s => s.includes(symptomSummary.slice(0, 30)))) {
          this.state.symptomsIdentified.push(symptomSummary);
        }
      } else if (this.extractionConfig.evidenceKeywords.some(kw => lower.includes(kw))) {
        type = 'evidence';
        confidence = 'medium';
      } else {
        // Skip sentences that don't match any pattern
        continue;
      }

      notes.push(
        this.addNote(type, trimmed, {
          confidence,
          sourceResultIds: resultId ? [resultId] : [],
          servicesInvolved: services,
        })
      );
    }

    return notes;
  }

  /**
   * Add services discovered during investigation.
   */
  addDiscoveredServices(services: string[]): void {
    const newServices = services.filter(s => !this.state.servicesDiscovered.includes(s));
    if (newServices.length > 0) {
      this.state.servicesDiscovered.push(...newServices);
      this.state.lastUpdatedAt = new Date().toISOString();
    }
  }

  /**
   * Update the progress summary.
   */
  updateProgressSummary(summary: string): void {
    this.state.progressSummary = summary;
    this.state.lastUpdatedAt = new Date().toISOString();
  }

  /**
   * Advance to the next iteration.
   */
  advanceIteration(): number {
    this.state.currentIteration++;
    this.state.lastUpdatedAt = new Date().toISOString();
    return this.state.currentIteration;
  }

  /**
   * Get notes by type.
   */
  getNotesByType(type: FindingType): InvestigationNote[] {
    return this.state.notes.filter(n => n.type === type);
  }

  /**
   * Get notes for a specific hypothesis.
   */
  getNotesByHypothesis(hypothesisId: string): InvestigationNote[] {
    return this.state.notes.filter(n => n.hypothesisId === hypothesisId);
  }

  /**
   * Get evidence notes with strong support.
   */
  getStrongEvidence(): InvestigationNote[] {
    return this.state.notes.filter(
      n => n.type === 'evidence' && n.evidenceStrength === 'strong'
    );
  }

  /**
   * Check if any notes reference a result ID.
   */
  isResultCited(resultId: string): boolean {
    return this.state.notes.some(n => n.sourceResultIds.includes(resultId));
  }

  /**
   * Get the current state.
   */
  getState(): Readonly<InvestigationState> {
    return this.state;
  }

  /**
   * Check if a root cause has been confirmed.
   */
  hasConfirmedRootCause(): boolean {
    return !!this.state.confirmedRootCause;
  }

  /**
   * Build a compact summary for injection into prompts.
   */
  buildContextSummary(): string {
    const sections: string[] = [];

    // Progress summary
    sections.push(`## Investigation Progress\n\n${this.state.progressSummary}`);

    // Services discovered
    if (this.state.servicesDiscovered.length > 0) {
      sections.push(`**Services involved:** ${this.state.servicesDiscovered.slice(0, 10).join(', ')}`);
    }

    // Symptoms identified
    if (this.state.symptomsIdentified.length > 0) {
      sections.push('**Symptoms:**');
      this.state.symptomsIdentified.slice(0, 5).forEach(s => {
        sections.push(`- ${s.slice(0, 100)}`);
      });
    }

    // Active hypotheses
    if (this.state.activeHypotheses.length > 0) {
      sections.push(`**Active hypotheses:** ${this.state.activeHypotheses.length}`);
    }

    // Pruned hypotheses
    if (this.state.prunedHypotheses.length > 0) {
      sections.push(`**Pruned hypotheses:** ${this.state.prunedHypotheses.length}`);
    }

    // Root cause candidates
    const rootCauseCandidates = this.getNotesByType('root_cause_candidate');
    if (rootCauseCandidates.length > 0) {
      sections.push('**Root cause candidates:**');
      rootCauseCandidates.slice(-3).forEach(n => {
        sections.push(`- ${n.content.slice(0, 100)} (${n.confidence})`);
      });
    }

    // Confirmed root cause
    if (this.state.confirmedRootCause) {
      sections.push(`\n**CONFIRMED ROOT CAUSE (${this.state.confirmedRootCause.confidence}):**`);
      sections.push(this.state.confirmedRootCause.hypothesis);
    }

    return sections.join('\n\n');
  }

  /**
   * Generate a structured final summary for answer generation.
   */
  buildFinalSummary(): string {
    const sections: string[] = [];

    sections.push(`Query: ${this.state.query}`);
    if (this.state.incidentId) {
      sections.push(`Incident: ${this.state.incidentId}`);
    }
    sections.push(`Duration: ${this.state.currentIteration} iterations`);

    // Confirmed root cause
    if (this.state.confirmedRootCause) {
      sections.push('\n**Root Cause:**');
      sections.push(`${this.state.confirmedRootCause.hypothesis}`);
      sections.push(`Confidence: ${this.state.confirmedRootCause.confidence}`);
      if (this.state.confirmedRootCause.evidence.length > 0) {
        sections.push('\n**Supporting Evidence:**');
        this.state.confirmedRootCause.evidence.slice(0, 5).forEach(e => {
          sections.push(`- ${e.slice(0, 150)}`);
        });
      }
    }

    // Services impacted
    if (this.state.servicesDiscovered.length > 0) {
      sections.push('\n**Services Investigated:**');
      sections.push(this.state.servicesDiscovered.join(', '));
    }

    // Key symptoms
    if (this.state.symptomsIdentified.length > 0) {
      sections.push('\n**Symptoms Observed:**');
      this.state.symptomsIdentified.slice(0, 5).forEach(s => {
        sections.push(`- ${s.slice(0, 100)}`);
      });
    }

    // Remediation steps if any
    const remediations = this.getNotesByType('remediation_step');
    if (remediations.length > 0) {
      sections.push('\n**Suggested Remediation:**');
      remediations.forEach(r => {
        sections.push(`- ${r.content}`);
      });
    }

    return sections.join('\n');
  }

  /**
   * Get session ID for resumption.
   */
  getSessionId(): string {
    return this.state.sessionId;
  }

  /**
   * Check if services need re-querying based on new discoveries.
   */
  hasNewServicesForKnowledgeQuery(previousServices: string[]): string[] {
    return this.state.servicesDiscovered.filter(s => !previousServices.includes(s));
  }

  /**
   * Check if symptoms need re-querying for known issues.
   */
  hasNewSymptomsForKnownIssueQuery(previousSymptoms: string[]): string[] {
    return this.state.symptomsIdentified.filter(s => !previousSymptoms.includes(s));
  }
}
