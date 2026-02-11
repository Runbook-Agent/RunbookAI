/**
 * Conversation Memory
 *
 * Manages conversation history and context for chat mode.
 * Supports context summarization, reference to previous findings,
 * and investigation context continuity.
 */

import type { InvestigationResult } from './investigation-orchestrator';
import type { TriageResult, Conclusion, InvestigationHypothesis } from './state-machine';

/**
 * Message role in conversation
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * A single message in the conversation
 */
export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  metadata?: {
    investigationId?: string;
    hypothesisId?: string;
    toolCalls?: string[];
    tokens?: number;
  };
}

/**
 * Investigation context stored in memory
 */
export interface InvestigationContext {
  id: string;
  query: string;
  triage?: TriageResult;
  hypotheses: InvestigationHypothesis[];
  conclusion?: Conclusion;
  startedAt: Date;
  completedAt?: Date;
}

/**
 * Conversation summary for context compression
 */
export interface ConversationSummary {
  topics: string[];
  findings: string[];
  decisions: string[];
  openQuestions: string[];
  investigationsSummary?: string;
}

/**
 * Memory configuration
 */
export interface MemoryConfig {
  maxMessages?: number;
  maxTokens?: number;
  summarizeAfterMessages?: number;
  persistPath?: string;
}

const DEFAULT_CONFIG: Required<MemoryConfig> = {
  maxMessages: 100,
  maxTokens: 50000,
  summarizeAfterMessages: 20,
  persistPath: '',
};

/**
 * Conversation Memory Manager
 */
export class ConversationMemory {
  private messages: ConversationMessage[] = [];
  private investigations: Map<string, InvestigationContext> = new Map();
  private summaries: ConversationSummary[] = [];
  private config: Required<MemoryConfig>;
  private messageIdCounter = 0;

  constructor(config: MemoryConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now().toString(36)}_${(++this.messageIdCounter).toString(36)}`;
  }

  /**
   * Add a message to the conversation
   */
  addMessage(
    role: MessageRole,
    content: string,
    metadata?: ConversationMessage['metadata']
  ): ConversationMessage {
    const message: ConversationMessage = {
      id: this.generateMessageId(),
      role,
      content,
      timestamp: new Date(),
      metadata,
    };

    this.messages.push(message);

    // Check if we need to summarize
    if (this.messages.length >= this.config.summarizeAfterMessages) {
      this.maybeCompress();
    }

    return message;
  }

  /**
   * Add a user message
   */
  addUserMessage(content: string): ConversationMessage {
    return this.addMessage('user', content);
  }

  /**
   * Add an assistant message
   */
  addAssistantMessage(
    content: string,
    metadata?: ConversationMessage['metadata']
  ): ConversationMessage {
    return this.addMessage('assistant', content, metadata);
  }

  /**
   * Add a system message
   */
  addSystemMessage(content: string): ConversationMessage {
    return this.addMessage('system', content);
  }

  /**
   * Get all messages
   */
  getMessages(): ConversationMessage[] {
    return [...this.messages];
  }

  /**
   * Get recent messages
   */
  getRecentMessages(count: number): ConversationMessage[] {
    return this.messages.slice(-count);
  }

  /**
   * Get messages since a specific message ID
   */
  getMessagesSince(messageId: string): ConversationMessage[] {
    const index = this.messages.findIndex((m) => m.id === messageId);
    if (index === -1) return [];
    return this.messages.slice(index + 1);
  }

  /**
   * Get the last message
   */
  getLastMessage(): ConversationMessage | undefined {
    return this.messages[this.messages.length - 1];
  }

  /**
   * Get the last user message
   */
  getLastUserMessage(): ConversationMessage | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') {
        return this.messages[i];
      }
    }
    return undefined;
  }

  /**
   * Store investigation context
   */
  addInvestigation(result: InvestigationResult, context: Partial<InvestigationContext>): void {
    this.investigations.set(result.id, {
      id: result.id,
      query: result.query,
      triage: context.triage,
      hypotheses: context.hypotheses || [],
      conclusion: context.conclusion,
      startedAt: context.startedAt || new Date(),
      completedAt: new Date(),
    });
  }

  /**
   * Get investigation by ID
   */
  getInvestigation(id: string): InvestigationContext | undefined {
    return this.investigations.get(id);
  }

  /**
   * Get all investigations
   */
  getInvestigations(): InvestigationContext[] {
    return Array.from(this.investigations.values());
  }

  /**
   * Get recent investigations
   */
  getRecentInvestigations(count: number): InvestigationContext[] {
    return Array.from(this.investigations.values())
      .sort((a, b) => (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0))
      .slice(0, count);
  }

  /**
   * Search messages for content
   */
  searchMessages(query: string): ConversationMessage[] {
    const lowerQuery = query.toLowerCase();
    return this.messages.filter((m) => m.content.toLowerCase().includes(lowerQuery));
  }

  /**
   * Search investigations
   */
  searchInvestigations(query: string): InvestigationContext[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.investigations.values()).filter(
      (inv) =>
        inv.query.toLowerCase().includes(lowerQuery) ||
        inv.conclusion?.rootCause.toLowerCase().includes(lowerQuery) ||
        inv.triage?.summary.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get context for a new message (for LLM context window)
   */
  getContextForPrompt(maxTokens?: number): string {
    const parts: string[] = [];
    const limit = maxTokens || this.config.maxTokens;

    // Add summaries first (most compressed context)
    if (this.summaries.length > 0) {
      const latestSummary = this.summaries[this.summaries.length - 1];
      parts.push(this.formatSummary(latestSummary));
    }

    // Add recent investigation contexts
    const recentInvestigations = this.getRecentInvestigations(3);
    if (recentInvestigations.length > 0) {
      parts.push('## Recent Investigations\n');
      for (const inv of recentInvestigations) {
        parts.push(this.formatInvestigationContext(inv));
      }
    }

    // Add recent messages
    const recentMessages = this.getRecentMessages(20);
    if (recentMessages.length > 0) {
      parts.push('## Recent Conversation\n');
      for (const msg of recentMessages) {
        parts.push(this.formatMessage(msg));
      }
    }

    // Simple token estimation (4 chars per token)
    let context = parts.join('\n');
    const estimatedTokens = Math.ceil(context.length / 4);

    if (estimatedTokens > limit) {
      // Truncate from the beginning (keep most recent)
      const targetLength = limit * 4;
      context = context.slice(-targetLength);
    }

    return context;
  }

  /**
   * Format a message for context
   */
  private formatMessage(message: ConversationMessage): string {
    const roleLabel =
      message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : 'System';
    return `${roleLabel}: ${message.content}`;
  }

  /**
   * Format investigation context
   */
  private formatInvestigationContext(inv: InvestigationContext): string {
    const lines: string[] = [];
    lines.push(`- Query: ${inv.query}`);
    if (inv.conclusion) {
      lines.push(`  Root Cause: ${inv.conclusion.rootCause}`);
      lines.push(`  Confidence: ${inv.conclusion.confidence}`);
    } else if (inv.triage) {
      lines.push(`  Status: In progress`);
      lines.push(`  Severity: ${inv.triage.severity}`);
    }
    return lines.join('\n');
  }

  /**
   * Format summary for context
   */
  private formatSummary(summary: ConversationSummary): string {
    const lines: string[] = [];
    lines.push('## Conversation Summary\n');

    if (summary.topics.length > 0) {
      lines.push(`Topics discussed: ${summary.topics.join(', ')}`);
    }
    if (summary.findings.length > 0) {
      lines.push(`Key findings: ${summary.findings.join('; ')}`);
    }
    if (summary.decisions.length > 0) {
      lines.push(`Decisions made: ${summary.decisions.join('; ')}`);
    }
    if (summary.openQuestions.length > 0) {
      lines.push(`Open questions: ${summary.openQuestions.join('; ')}`);
    }
    if (summary.investigationsSummary) {
      lines.push(`\n${summary.investigationsSummary}`);
    }

    return lines.join('\n');
  }

  /**
   * Create a summary of the conversation (for compression)
   */
  createSummary(): ConversationSummary {
    const topics = new Set<string>();
    const findings: string[] = [];
    const decisions: string[] = [];
    const openQuestions: string[] = [];

    // Extract topics and findings from messages
    for (const msg of this.messages) {
      // Simple topic extraction (could be enhanced with LLM)
      const words = msg.content.toLowerCase().split(/\s+/);
      for (const word of words) {
        if (
          word.length > 5 &&
          !['about', 'which', 'there', 'their', 'would', 'could', 'should'].includes(word)
        ) {
          // Simple heuristic for potential topics
          if (
            msg.content.match(
              new RegExp(`\\b${word}\\b.*(?:issue|problem|error|service|database|api|server)`, 'i')
            )
          ) {
            topics.add(word);
          }
        }
      }

      // Extract findings from assistant messages
      if (msg.role === 'assistant') {
        const findingMatch = msg.content.match(
          /(?:found|discovered|identified|detected|root cause)[\s:]+([^.]+)/i
        );
        if (findingMatch) {
          findings.push(findingMatch[1].trim());
        }

        const decisionMatch = msg.content.match(/(?:will|should|recommend|suggest)[\s:]+([^.]+)/i);
        if (decisionMatch) {
          decisions.push(decisionMatch[1].trim());
        }
      }

      // Extract questions
      if (msg.role === 'user' && msg.content.includes('?')) {
        const questions = msg.content.match(/[^.!?]*\?/g);
        if (questions) {
          openQuestions.push(...questions.map((q) => q.trim()));
        }
      }
    }

    // Summarize investigations
    let investigationsSummary: string | undefined;
    if (this.investigations.size > 0) {
      const invSummaries: string[] = [];
      for (const inv of this.investigations.values()) {
        if (inv.conclusion) {
          invSummaries.push(
            `${inv.query}: ${inv.conclusion.rootCause} (${inv.conclusion.confidence} confidence)`
          );
        }
      }
      if (invSummaries.length > 0) {
        investigationsSummary = `Completed investigations:\n${invSummaries.join('\n')}`;
      }
    }

    return {
      topics: Array.from(topics).slice(0, 10),
      findings: findings.slice(0, 5),
      decisions: decisions.slice(0, 5),
      openQuestions: openQuestions.slice(-3), // Keep only recent questions
      investigationsSummary,
    };
  }

  /**
   * Compress conversation history by summarizing older messages
   */
  private maybeCompress(): void {
    if (this.messages.length < this.config.summarizeAfterMessages * 2) {
      return;
    }

    // Create summary of older messages
    const summary = this.createSummary();
    this.summaries.push(summary);

    // Keep only recent messages
    const keepCount = Math.floor(this.config.summarizeAfterMessages / 2);
    this.messages = this.messages.slice(-keepCount);
  }

  /**
   * Clear all memory
   */
  clear(): void {
    this.messages = [];
    this.investigations.clear();
    this.summaries = [];
    this.messageIdCounter = 0;
  }

  /**
   * Clear only messages (keep investigations and summaries)
   */
  clearMessages(): void {
    this.messages = [];
  }

  /**
   * Get memory statistics
   */
  getStats(): {
    messageCount: number;
    investigationCount: number;
    summaryCount: number;
    estimatedTokens: number;
  } {
    const totalContent = this.messages.map((m) => m.content).join('');
    return {
      messageCount: this.messages.length,
      investigationCount: this.investigations.size,
      summaryCount: this.summaries.length,
      estimatedTokens: Math.ceil(totalContent.length / 4),
    };
  }

  /**
   * Export memory to JSON
   */
  toJSON(): string {
    return JSON.stringify(
      {
        messages: this.messages,
        investigations: Array.from(this.investigations.entries()),
        summaries: this.summaries,
        config: this.config,
      },
      null,
      2
    );
  }

  /**
   * Import memory from JSON
   */
  static fromJSON(json: string): ConversationMemory {
    const data = JSON.parse(json);
    const memory = new ConversationMemory(data.config);

    memory.messages = data.messages.map((m: any) => ({
      ...m,
      timestamp: new Date(m.timestamp),
    }));

    memory.investigations = new Map(
      data.investigations.map(([id, inv]: [string, any]) => [
        id,
        {
          ...inv,
          startedAt: new Date(inv.startedAt),
          completedAt: inv.completedAt ? new Date(inv.completedAt) : undefined,
        },
      ])
    );

    memory.summaries = data.summaries;

    return memory;
  }

  /**
   * Get a reference string for a previous finding
   */
  getReference(query: string): string | undefined {
    // Search investigations first
    for (const inv of this.investigations.values()) {
      if (inv.conclusion && inv.query.toLowerCase().includes(query.toLowerCase())) {
        return `In a previous investigation "${inv.query}", the root cause was identified as: ${inv.conclusion.rootCause}`;
      }
    }

    // Search messages
    const matches = this.searchMessages(query);
    if (matches.length > 0) {
      const match = matches[matches.length - 1];
      return `Previously mentioned: "${match.content.substring(0, 200)}..."`;
    }

    return undefined;
  }

  /**
   * Get related context for a query
   */
  getRelatedContext(query: string): {
    investigations: InvestigationContext[];
    messages: ConversationMessage[];
  } {
    return {
      investigations: this.searchInvestigations(query),
      messages: this.searchMessages(query).slice(-5),
    };
  }
}

/**
 * Create a new conversation memory instance
 */
export function createMemory(config?: MemoryConfig): ConversationMemory {
  return new ConversationMemory(config);
}
