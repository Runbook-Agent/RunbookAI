/**
 * Knowledge Context
 *
 * Proactive knowledge retrieval that continuously re-queries
 * the knowledge base when new services or symptoms are discovered.
 */

import type { KnowledgeRetriever } from '../knowledge/retriever/index';
import type {
  RetrievedKnowledge,
  RetrievedChunk,
  KnowledgeType,
  ServiceOwnership,
} from '../knowledge/types';
import type { InvestigationState } from './investigation-memory';

/**
 * Lightweight index entry for runbooks.
 */
export interface RunbookIndexEntry {
  id: string;
  title: string;
  services: string[];
  symptoms?: string[];
  severity?: string;
}

/**
 * Lightweight index entry for known issues.
 */
export interface KnownIssueIndexEntry {
  id: string;
  title: string;
  services: string[];
  symptoms: string[];
  workaround?: string;
  resolved: boolean;
}

/**
 * Pre-loaded lightweight knowledge index.
 */
export interface KnowledgeIndex {
  /** All runbooks with lightweight metadata */
  runbooks: RunbookIndexEntry[];
  /** Active known issues */
  activeKnownIssues: KnownIssueIndexEntry[];
  /** All postmortem titles */
  postmortems: Array<{ id: string; title: string; services: string[]; rootCause: string }>;
  /** Last refresh time */
  lastRefreshed: string;
}

/**
 * Full knowledge context available for the current investigation.
 */
export interface KnowledgeContext {
  /** Pre-loaded lightweight index */
  index: KnowledgeIndex;
  /** Retrieved runbooks based on current investigation */
  relevantRunbooks: RetrievedChunk[];
  /** Retrieved postmortems based on current investigation */
  relevantPostmortems: RetrievedChunk[];
  /** Retrieved architecture docs based on current investigation */
  relevantArchitecture: RetrievedChunk[];
  /** Known issues matching current symptoms */
  matchingKnownIssues: RetrievedChunk[];
  /** Service ownership information */
  serviceOwnership: Map<string, ServiceOwnership>;
  /** Services that have been queried */
  queriedServices: Set<string>;
  /** Symptoms that have been queried */
  queriedSymptoms: Set<string>;
}

/**
 * Configuration for knowledge context.
 */
export interface KnowledgeContextConfig {
  /** Maximum runbooks to keep in context */
  maxRunbooks: number;
  /** Maximum postmortems to keep in context */
  maxPostmortems: number;
  /** Maximum known issues to keep in context */
  maxKnownIssues: number;
  /** Maximum architecture docs to keep in context */
  maxArchitecture: number;
  /** Minimum relevance score to include */
  minRelevanceScore: number;
  /** Auto-refresh index interval in ms (0 = never) */
  indexRefreshInterval: number;
}

const DEFAULT_CONFIG: KnowledgeContextConfig = {
  maxRunbooks: 5,
  maxPostmortems: 3,
  maxKnownIssues: 5,
  maxArchitecture: 2,
  minRelevanceScore: 0.3,
  indexRefreshInterval: 5 * 60 * 1000, // 5 minutes
};

/**
 * KnowledgeContextManager manages proactive knowledge retrieval.
 */
export class KnowledgeContextManager {
  private readonly config: KnowledgeContextConfig;
  private readonly retriever: KnowledgeRetriever;
  private context: KnowledgeContext;

  constructor(retriever: KnowledgeRetriever, config: Partial<KnowledgeContextConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.retriever = retriever;
    this.context = this.createEmptyContext();
  }

  /**
   * Create an empty context structure.
   */
  private createEmptyContext(): KnowledgeContext {
    return {
      index: {
        runbooks: [],
        activeKnownIssues: [],
        postmortems: [],
        lastRefreshed: '',
      },
      relevantRunbooks: [],
      relevantPostmortems: [],
      relevantArchitecture: [],
      matchingKnownIssues: [],
      serviceOwnership: new Map(),
      queriedServices: new Set(),
      queriedSymptoms: new Set(),
    };
  }

  /**
   * Initialize the context by loading the lightweight index.
   */
  async init(): Promise<void> {
    await this.refreshIndex();
  }

  /**
   * Refresh the lightweight knowledge index.
   */
  async refreshIndex(): Promise<void> {
    // Load all documents with minimal content
    const allKnowledge = await this.retriever.search('*', { limit: 1000 });

    // Build lightweight index
    const runbooks: RunbookIndexEntry[] = [];
    const knownIssues: KnownIssueIndexEntry[] = [];
    const postmortems: Array<{ id: string; title: string; services: string[]; rootCause: string }> = [];

    for (const chunk of allKnowledge.runbooks) {
      // Dedupe by document ID
      if (!runbooks.some(r => r.id === chunk.documentId)) {
        runbooks.push({
          id: chunk.documentId,
          title: chunk.title,
          services: chunk.services,
          symptoms: this.extractSymptoms(chunk.content),
        });
      }
    }

    for (const chunk of allKnowledge.knownIssues) {
      if (!knownIssues.some(k => k.id === chunk.documentId)) {
        const symptoms = this.extractSymptoms(chunk.content);
        knownIssues.push({
          id: chunk.documentId,
          title: chunk.title,
          services: chunk.services,
          symptoms,
          resolved: this.isResolved(chunk.content),
        });
      }
    }

    for (const chunk of allKnowledge.postmortems) {
      if (!postmortems.some(p => p.id === chunk.documentId)) {
        postmortems.push({
          id: chunk.documentId,
          title: chunk.title,
          services: chunk.services,
          rootCause: this.extractRootCause(chunk.content),
        });
      }
    }

    this.context.index = {
      runbooks,
      activeKnownIssues: knownIssues.filter(k => !k.resolved),
      postmortems,
      lastRefreshed: new Date().toISOString(),
    };
  }

  /**
   * Extract symptoms from document content.
   */
  private extractSymptoms(content: string): string[] {
    const symptoms: string[] = [];
    const symptomsMatch = content.match(/symptoms?:?\s*([\s\S]*?)(?:\n\n|\n#|$)/i);
    if (symptomsMatch) {
      const symptomLines = symptomsMatch[1].split('\n');
      for (const line of symptomLines) {
        const cleaned = line.replace(/^[-*]\s*/, '').trim();
        if (cleaned.length > 5 && cleaned.length < 200) {
          symptoms.push(cleaned);
        }
      }
    }
    return symptoms.slice(0, 10);
  }

  /**
   * Extract root cause from postmortem content.
   */
  private extractRootCause(content: string): string {
    const rootCauseMatch = content.match(/root\s*cause:?\s*(.*?)(?:\n\n|\n#|$)/i);
    return rootCauseMatch ? rootCauseMatch[1].slice(0, 200) : '';
  }

  /**
   * Check if a known issue is resolved.
   */
  private isResolved(content: string): boolean {
    return /resolved|fixed|closed/i.test(content) && !/unresolved|not\s+fixed/i.test(content);
  }

  /**
   * Perform initial query based on the user's query.
   */
  async queryForInvestigation(query: string, services?: string[]): Promise<void> {
    const knowledge = await this.retriever.search(query, {
      serviceFilter: services,
      limit: this.config.maxRunbooks + this.config.maxPostmortems + this.config.maxKnownIssues,
    });

    this.mergeKnowledge(knowledge, services);

    // Track queried services
    if (services) {
      for (const service of services) {
        this.context.queriedServices.add(service);
      }
    }
  }

  /**
   * Re-query for newly discovered services.
   */
  async queryForNewServices(services: string[]): Promise<RetrievedKnowledge | null> {
    // Filter to only services not yet queried
    const newServices = services.filter(s => !this.context.queriedServices.has(s));
    if (newServices.length === 0) {
      return null;
    }

    const knowledge = await this.retriever.search(newServices.join(' '), {
      serviceFilter: newServices,
      limit: this.config.maxRunbooks,
    });

    this.mergeKnowledge(knowledge, newServices);

    // Track as queried
    for (const service of newServices) {
      this.context.queriedServices.add(service);
    }

    return knowledge;
  }

  /**
   * Re-query for newly discovered symptoms.
   */
  async queryForNewSymptoms(symptoms: string[]): Promise<RetrievedChunk[]> {
    // Filter to only symptoms not yet queried
    const newSymptoms = symptoms.filter(s => !this.context.queriedSymptoms.has(s));
    if (newSymptoms.length === 0) {
      return [];
    }

    // Search for matching known issues
    const knowledge = await this.retriever.search(newSymptoms.join(' '), {
      typeFilter: ['known_issue'],
      limit: this.config.maxKnownIssues,
    });

    // Merge new known issues
    for (const chunk of knowledge.knownIssues) {
      if (
        chunk.score >= this.config.minRelevanceScore &&
        !this.context.matchingKnownIssues.some(k => k.id === chunk.id)
      ) {
        this.context.matchingKnownIssues.push(chunk);
      }
    }

    // Trim to max
    if (this.context.matchingKnownIssues.length > this.config.maxKnownIssues) {
      this.context.matchingKnownIssues.sort((a, b) => b.score - a.score);
      this.context.matchingKnownIssues = this.context.matchingKnownIssues.slice(0, this.config.maxKnownIssues);
    }

    // Track as queried
    for (const symptom of newSymptoms) {
      this.context.queriedSymptoms.add(symptom);
    }

    return knowledge.knownIssues;
  }

  /**
   * Update context based on investigation state changes.
   */
  async updateFromInvestigationState(
    state: InvestigationState,
    previousServices: string[] = [],
    previousSymptoms: string[] = []
  ): Promise<{
    newServices: string[];
    newSymptoms: string[];
    newKnowledge: RetrievedKnowledge | null;
    matchedKnownIssues: RetrievedChunk[];
  }> {
    // Find newly discovered services and symptoms
    const newServices = state.servicesDiscovered.filter(s => !previousServices.includes(s));
    const newSymptoms = state.symptomsIdentified.filter(s => !previousSymptoms.includes(s));

    let newKnowledge: RetrievedKnowledge | null = null;
    let matchedKnownIssues: RetrievedChunk[] = [];

    // Re-query for new services
    if (newServices.length > 0) {
      newKnowledge = await this.queryForNewServices(newServices);
    }

    // Re-query for new symptoms
    if (newSymptoms.length > 0) {
      matchedKnownIssues = await this.queryForNewSymptoms(newSymptoms);
    }

    return {
      newServices,
      newSymptoms,
      newKnowledge,
      matchedKnownIssues,
    };
  }

  /**
   * Merge retrieved knowledge into context.
   */
  private mergeKnowledge(knowledge: RetrievedKnowledge, services?: string[]): void {
    // Merge runbooks
    for (const chunk of knowledge.runbooks) {
      if (
        chunk.score >= this.config.minRelevanceScore &&
        !this.context.relevantRunbooks.some(r => r.id === chunk.id)
      ) {
        this.context.relevantRunbooks.push(chunk);
      }
    }

    // Merge postmortems
    for (const chunk of knowledge.postmortems) {
      if (
        chunk.score >= this.config.minRelevanceScore &&
        !this.context.relevantPostmortems.some(p => p.id === chunk.id)
      ) {
        this.context.relevantPostmortems.push(chunk);
      }
    }

    // Merge architecture docs
    for (const chunk of knowledge.architecture) {
      if (
        chunk.score >= this.config.minRelevanceScore &&
        !this.context.relevantArchitecture.some(a => a.id === chunk.id)
      ) {
        this.context.relevantArchitecture.push(chunk);
      }
    }

    // Merge known issues
    for (const chunk of knowledge.knownIssues) {
      if (
        chunk.score >= this.config.minRelevanceScore &&
        !this.context.matchingKnownIssues.some(k => k.id === chunk.id)
      ) {
        this.context.matchingKnownIssues.push(chunk);
      }
    }

    // Merge ownership
    if (knowledge.ownership) {
      for (const ownership of knowledge.ownership) {
        this.context.serviceOwnership.set(ownership.service, ownership);
      }
    }

    // Enforce limits by sorting by score and trimming
    this.enforceContextLimits();
  }

  /**
   * Enforce maximum limits on retrieved knowledge.
   */
  private enforceContextLimits(): void {
    const sortAndTrim = (arr: RetrievedChunk[], max: number): RetrievedChunk[] => {
      arr.sort((a, b) => b.score - a.score);
      return arr.slice(0, max);
    };

    this.context.relevantRunbooks = sortAndTrim(this.context.relevantRunbooks, this.config.maxRunbooks);
    this.context.relevantPostmortems = sortAndTrim(this.context.relevantPostmortems, this.config.maxPostmortems);
    this.context.relevantArchitecture = sortAndTrim(this.context.relevantArchitecture, this.config.maxArchitecture);
    this.context.matchingKnownIssues = sortAndTrim(this.context.matchingKnownIssues, this.config.maxKnownIssues);
  }

  /**
   * Get the current knowledge context.
   */
  getContext(): Readonly<KnowledgeContext> {
    return this.context;
  }

  /**
   * Build the knowledge index section for system prompt.
   */
  buildIndexSection(): string {
    const { index } = this.context;
    const sections: string[] = [];

    sections.push('## Available Knowledge\n');

    // Runbooks summary
    if (index.runbooks.length > 0) {
      sections.push(`**Runbooks:** ${index.runbooks.length} available`);
      const serviceToRunbooks = new Map<string, string[]>();
      for (const rb of index.runbooks) {
        for (const service of rb.services) {
          const list = serviceToRunbooks.get(service) || [];
          list.push(rb.title);
          serviceToRunbooks.set(service, list);
        }
      }
      if (serviceToRunbooks.size > 0) {
        sections.push('Services with runbooks: ' + Array.from(serviceToRunbooks.keys()).slice(0, 10).join(', '));
      }
    }

    // Active known issues
    if (index.activeKnownIssues.length > 0) {
      sections.push(`\n**Active Known Issues:** ${index.activeKnownIssues.length}`);
      for (const issue of index.activeKnownIssues.slice(0, 3)) {
        sections.push(`- ${issue.title} (${issue.services.join(', ')})`);
      }
    }

    // Recent postmortems
    if (index.postmortems.length > 0) {
      sections.push(`\n**Postmortems:** ${index.postmortems.length} available`);
    }

    return sections.join('\n');
  }

  /**
   * Build the relevant knowledge section for current investigation.
   */
  buildRelevantKnowledgeSection(): string {
    const sections: string[] = [];

    // Relevant runbooks
    if (this.context.relevantRunbooks.length > 0) {
      sections.push('## Relevant Runbooks\n');
      for (const rb of this.context.relevantRunbooks) {
        sections.push(`### ${rb.title}`);
        sections.push(`Services: ${rb.services.join(', ')}`);
        sections.push(rb.content.slice(0, 1000));
        sections.push('');
      }
    }

    // Matching known issues
    if (this.context.matchingKnownIssues.length > 0) {
      sections.push('## Matching Known Issues\n');
      for (const issue of this.context.matchingKnownIssues) {
        sections.push(`### ${issue.title}`);
        sections.push(`Services: ${issue.services.join(', ')}`);
        sections.push(issue.content.slice(0, 500));
        sections.push('');
      }
    }

    // Similar past incidents
    if (this.context.relevantPostmortems.length > 0) {
      sections.push('## Similar Past Incidents\n');
      for (const pm of this.context.relevantPostmortems) {
        sections.push(`### ${pm.title}`);
        sections.push(pm.content.slice(0, 500));
        sections.push('');
      }
    }

    return sections.join('\n');
  }

  /**
   * Build compact knowledge summary for iteration prompts.
   */
  buildCompactSummary(): string {
    const parts: string[] = [];

    if (this.context.relevantRunbooks.length > 0) {
      parts.push(`Runbooks: ${this.context.relevantRunbooks.map(r => r.title).join(', ')}`);
    }

    if (this.context.matchingKnownIssues.length > 0) {
      parts.push(`Known Issues: ${this.context.matchingKnownIssues.map(k => k.title).join(', ')}`);
    }

    if (this.context.relevantPostmortems.length > 0) {
      parts.push(`Related Postmortems: ${this.context.relevantPostmortems.length}`);
    }

    return parts.length > 0 ? parts.join('; ') : 'No relevant knowledge found.';
  }

  /**
   * Check if a service has a runbook.
   */
  hasRunbookForService(serviceName: string): boolean {
    const lowerName = serviceName.toLowerCase();
    return this.context.index.runbooks.some(r =>
      r.services.some(s => s.toLowerCase().includes(lowerName))
    );
  }

  /**
   * Get services with runbooks that haven't been queried.
   */
  getUnqueriedServicesWithRunbooks(): string[] {
    const servicesWithRunbooks = new Set<string>();
    for (const rb of this.context.index.runbooks) {
      for (const service of rb.services) {
        servicesWithRunbooks.add(service);
      }
    }

    return Array.from(servicesWithRunbooks).filter(s => !this.context.queriedServices.has(s));
  }

  /**
   * Get service ownership information.
   */
  getServiceOwnership(serviceName: string): ServiceOwnership | undefined {
    return this.context.serviceOwnership.get(serviceName);
  }

  /**
   * Find known issues matching symptoms.
   */
  findMatchingKnownIssues(symptoms: string[]): KnownIssueIndexEntry[] {
    const symptomsLower = symptoms.map(s => s.toLowerCase());
    return this.context.index.activeKnownIssues.filter(issue => {
      for (const issueSymptom of issue.symptoms) {
        const issueLower = issueSymptom.toLowerCase();
        for (const symptom of symptomsLower) {
          if (issueLower.includes(symptom) || symptom.includes(issueLower)) {
            return true;
          }
        }
      }
      return false;
    });
  }

  /**
   * Reset the context for a new investigation.
   */
  reset(): void {
    const savedIndex = this.context.index;
    this.context = this.createEmptyContext();
    this.context.index = savedIndex;
  }
}
