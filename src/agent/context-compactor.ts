/**
 * Context Compactor
 *
 * Smart importance-based compaction for tool results.
 * Replaces naive "clear oldest N" with hypothesis-aware scoring.
 */

import type { ToolResultEntry, EvidenceStrength } from './types';
import type { InvestigationState } from './investigation-memory';
import type { CompactToolResult } from './tool-summarizer';

/**
 * Scored result ready for compaction decisions.
 */
export interface ScoredResult {
  /** The original tool result entry */
  entry: ToolResultEntry;
  /** Computed importance score (0-1) */
  score: number;
  /** Breakdown of score components */
  components: ScoreComponents;
  /** Compact representation if available */
  compact?: CompactToolResult;
  /** Whether this result should be kept in full */
  keepFull: boolean;
}

/**
 * Breakdown of importance score components.
 */
export interface ScoreComponents {
  recency: number;
  queryRelevance: number;
  errorSignals: number;
  hypothesisRelevance: number;
  serviceRelevance: number;
  citedInNotes: number;
}

/**
 * Weights for importance scoring factors.
 */
export interface ScoreWeights {
  recency: number;
  queryRelevance: number;
  errorSignals: number;
  hypothesisRelevance: number;
  serviceRelevance: number;
  citedInNotes: number;
}

/**
 * Result of a compaction operation.
 */
export interface CompactionPlan {
  /** Results to keep in full */
  keepFull: ScoredResult[];
  /** Results to keep as compact summaries */
  keepCompact: ScoredResult[];
  /** Results to clear from context */
  clear: ScoredResult[];
  /** Total tokens saved (estimate) */
  estimatedTokensSaved: number;
}

/**
 * Configuration for the compactor.
 */
export interface CompactorConfig {
  /** Score weights */
  weights: ScoreWeights;
  /** Maximum results to keep in full form */
  maxFullResults: number;
  /** Maximum results to keep as compact summaries */
  maxCompactResults: number;
  /** Minimum score to keep in full (0-1) */
  minScoreForFull: number;
  /** Minimum score to keep at all (0-1) */
  minScoreToKeep: number;
  /** Average tokens per full result (estimate) */
  tokensPerFullResult: number;
  /** Average tokens per compact result (estimate) */
  tokensPerCompactResult: number;
}

const DEFAULT_CONFIG: CompactorConfig = {
  weights: {
    recency: 0.20,
    queryRelevance: 0.20,
    errorSignals: 0.20,
    hypothesisRelevance: 0.15,
    serviceRelevance: 0.10,
    citedInNotes: 0.15,
  },
  maxFullResults: 10,
  maxCompactResults: 15,
  minScoreForFull: 0.6,
  minScoreToKeep: 0.2,
  tokensPerFullResult: 2000,
  tokensPerCompactResult: 150,
};

/**
 * ContextCompactor implements smart importance-based compaction.
 */
export class ContextCompactor {
  private readonly config: CompactorConfig;

  constructor(config: Partial<CompactorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (config.weights) {
      this.config.weights = { ...DEFAULT_CONFIG.weights, ...config.weights };
    }
  }

  /**
   * Score a single tool result based on investigation context.
   */
  scoreResult(
    entry: ToolResultEntry,
    context: {
      query: string;
      investigationState?: InvestigationState;
      activeHypotheses?: string[];
      servicesUnderInvestigation?: string[];
      resultIdToCited?: Map<string, boolean>;
      compact?: CompactToolResult;
      currentIteration: number;
      totalResults: number;
      resultIndex: number;
    }
  ): ScoredResult {
    const components = this.computeScoreComponents(entry, context);
    const score = this.computeWeightedScore(components);

    return {
      entry,
      score,
      components,
      compact: context.compact,
      keepFull: score >= this.config.minScoreForFull,
    };
  }

  /**
   * Compute individual score components.
   */
  private computeScoreComponents(
    entry: ToolResultEntry,
    context: {
      query: string;
      investigationState?: InvestigationState;
      activeHypotheses?: string[];
      servicesUnderInvestigation?: string[];
      resultIdToCited?: Map<string, boolean>;
      compact?: CompactToolResult;
      currentIteration: number;
      totalResults: number;
      resultIndex: number;
    }
  ): ScoreComponents {
    return {
      recency: this.scoreRecency(context.resultIndex, context.totalResults),
      queryRelevance: this.scoreQueryRelevance(entry, context.query),
      errorSignals: this.scoreErrorSignals(entry, context.compact),
      hypothesisRelevance: this.scoreHypothesisRelevance(
        entry,
        context.investigationState,
        context.activeHypotheses
      ),
      serviceRelevance: this.scoreServiceRelevance(
        entry,
        context.servicesUnderInvestigation,
        context.compact
      ),
      citedInNotes: this.scoreCitedInNotes(
        context.compact?.resultId,
        context.resultIdToCited
      ),
    };
  }

  /**
   * Score based on recency (more recent = higher score).
   */
  private scoreRecency(resultIndex: number, totalResults: number): number {
    if (totalResults <= 1) return 1.0;
    // Linear decay from newest (1.0) to oldest (0.1)
    const position = resultIndex / (totalResults - 1);
    return 0.1 + 0.9 * position;
  }

  /**
   * Score based on relevance to the original query.
   */
  private scoreQueryRelevance(entry: ToolResultEntry, query: string): number {
    const queryLower = query.toLowerCase();
    const queryWords = new Set(queryLower.split(/\s+/).filter(w => w.length > 2));

    // Check tool args for query relevance
    const argsStr = JSON.stringify(entry.args).toLowerCase();
    const resultStr = typeof entry.result === 'string'
      ? entry.result.toLowerCase()
      : JSON.stringify(entry.result).toLowerCase();

    // Count matching words
    let matchCount = 0;
    for (const word of queryWords) {
      if (argsStr.includes(word) || resultStr.includes(word)) {
        matchCount++;
      }
    }

    // Normalize to 0-1
    return Math.min(1.0, matchCount / Math.max(1, queryWords.size));
  }

  /**
   * Score based on error signals in the result.
   */
  private scoreErrorSignals(
    entry: ToolResultEntry,
    compact?: CompactToolResult
  ): number {
    // Use compact result's hasErrors flag if available
    if (compact?.hasErrors) {
      return 1.0;
    }

    // Check for health status
    if (compact?.healthStatus === 'critical') {
      return 1.0;
    }
    if (compact?.healthStatus === 'degraded') {
      return 0.7;
    }

    // Fallback: check raw result for error patterns
    const resultStr = typeof entry.result === 'string'
      ? entry.result.toLowerCase()
      : JSON.stringify(entry.result).toLowerCase();

    const criticalKeywords = ['error', 'failed', 'exception', 'critical', 'alarm'];
    const warningKeywords = ['warning', 'timeout', 'unhealthy', 'degraded'];

    if (criticalKeywords.some(kw => resultStr.includes(kw))) {
      return 1.0;
    }
    if (warningKeywords.some(kw => resultStr.includes(kw))) {
      return 0.6;
    }

    return 0.0;
  }

  /**
   * Score based on relevance to active hypotheses.
   */
  private scoreHypothesisRelevance(
    entry: ToolResultEntry,
    investigationState?: InvestigationState,
    activeHypotheses?: string[]
  ): number {
    if (!investigationState && !activeHypotheses) {
      return 0.0;
    }

    const hypothesisIds = activeHypotheses || investigationState?.activeHypotheses || [];
    if (hypothesisIds.length === 0) {
      return 0.0;
    }

    // Check if this result was gathered as evidence for a hypothesis
    if (investigationState) {
      const evidenceNotes = investigationState.notes.filter(
        n => n.type === 'evidence' && n.hypothesisId
      );

      for (const note of evidenceNotes) {
        if (
          hypothesisIds.includes(note.hypothesisId!) &&
          note.sourceResultIds.some(id => this.resultMatchesId(entry, id))
        ) {
          // Strong match: evidence for active hypothesis
          return note.evidenceStrength === 'strong' ? 1.0 : 0.7;
        }
      }
    }

    // Weaker signal: tool call might be related to hypothesis investigation
    const argsStr = JSON.stringify(entry.args).toLowerCase();

    // Check if tool was investigating symptoms related to hypotheses
    if (investigationState?.symptomsIdentified) {
      for (const symptom of investigationState.symptomsIdentified) {
        if (argsStr.includes(symptom.toLowerCase().slice(0, 20))) {
          return 0.5;
        }
      }
    }

    return 0.0;
  }

  /**
   * Score based on service relevance.
   */
  private scoreServiceRelevance(
    entry: ToolResultEntry,
    servicesUnderInvestigation?: string[],
    compact?: CompactToolResult
  ): number {
    if (!servicesUnderInvestigation || servicesUnderInvestigation.length === 0) {
      return 0.0;
    }

    // Use compact result's services if available
    const resultServices = compact?.services || [];
    const argsStr = JSON.stringify(entry.args).toLowerCase();
    const resultStr = typeof entry.result === 'string'
      ? entry.result.toLowerCase()
      : JSON.stringify(entry.result).toLowerCase();

    // Check for service matches
    for (const service of servicesUnderInvestigation) {
      const serviceLower = service.toLowerCase();

      // Direct match in compact services
      if (resultServices.some(s => s.toLowerCase().includes(serviceLower))) {
        return 1.0;
      }

      // Match in args or result
      if (argsStr.includes(serviceLower) || resultStr.includes(serviceLower)) {
        return 0.8;
      }
    }

    return 0.0;
  }

  /**
   * Score based on whether result is cited in investigation notes.
   */
  private scoreCitedInNotes(
    resultId?: string,
    resultIdToCited?: Map<string, boolean>
  ): number {
    if (!resultId || !resultIdToCited) {
      return 0.0;
    }
    return resultIdToCited.get(resultId) ? 1.0 : 0.0;
  }

  /**
   * Check if an entry matches a result ID.
   */
  private resultMatchesId(entry: ToolResultEntry, resultId: string): boolean {
    // Result IDs are formatted as `{tool}-{hash}`
    // Check if this entry could have generated this ID
    const toolPrefix = entry.tool.slice(0, 3);
    return resultId.startsWith(toolPrefix);
  }

  /**
   * Compute weighted score from components.
   */
  private computeWeightedScore(components: ScoreComponents): number {
    const { weights } = this.config;
    return (
      components.recency * weights.recency +
      components.queryRelevance * weights.queryRelevance +
      components.errorSignals * weights.errorSignals +
      components.hypothesisRelevance * weights.hypothesisRelevance +
      components.serviceRelevance * weights.serviceRelevance +
      components.citedInNotes * weights.citedInNotes
    );
  }

  /**
   * Create a compaction plan for a set of results.
   */
  compact(
    results: ToolResultEntry[],
    context: {
      query: string;
      investigationState?: InvestigationState;
      compactResults?: Map<ToolResultEntry, CompactToolResult>;
      tokenBudget?: number;
    }
  ): CompactionPlan {
    const { query, investigationState, compactResults } = context;

    // Build helper maps
    const resultIdToCited = new Map<string, boolean>();
    if (investigationState) {
      for (const note of investigationState.notes) {
        for (const resultId of note.sourceResultIds) {
          resultIdToCited.set(resultId, true);
        }
      }
    }

    const servicesUnderInvestigation = investigationState?.servicesDiscovered || [];
    const activeHypotheses = investigationState?.activeHypotheses || [];

    // Score all results
    const scored: ScoredResult[] = results.map((entry, index) => {
      const compact = compactResults?.get(entry);
      return this.scoreResult(entry, {
        query,
        investigationState,
        activeHypotheses,
        servicesUnderInvestigation,
        resultIdToCited,
        compact,
        currentIteration: investigationState?.currentIteration || 0,
        totalResults: results.length,
        resultIndex: index,
      });
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Allocate to tiers
    const keepFull: ScoredResult[] = [];
    const keepCompact: ScoredResult[] = [];
    const clear: ScoredResult[] = [];

    // If we have a token budget, use that
    if (context.tokenBudget) {
      return this.compactWithBudget(scored, context.tokenBudget);
    }

    // Otherwise use count-based allocation
    for (const result of scored) {
      if (
        keepFull.length < this.config.maxFullResults &&
        result.score >= this.config.minScoreForFull
      ) {
        result.keepFull = true;
        keepFull.push(result);
      } else if (
        keepCompact.length < this.config.maxCompactResults &&
        result.score >= this.config.minScoreToKeep
      ) {
        result.keepFull = false;
        keepCompact.push(result);
      } else {
        result.keepFull = false;
        clear.push(result);
      }
    }

    // Estimate tokens saved
    const fullTokens = keepFull.length * this.config.tokensPerFullResult;
    const compactTokens = keepCompact.length * this.config.tokensPerCompactResult;
    const originalTokens = scored.length * this.config.tokensPerFullResult;
    const estimatedTokensSaved = originalTokens - fullTokens - compactTokens;

    return {
      keepFull,
      keepCompact,
      clear,
      estimatedTokensSaved,
    };
  }

  /**
   * Compact with a specific token budget.
   */
  private compactWithBudget(
    sorted: ScoredResult[],
    budget: number
  ): CompactionPlan {
    const keepFull: ScoredResult[] = [];
    const keepCompact: ScoredResult[] = [];
    const clear: ScoredResult[] = [];

    let usedTokens = 0;

    for (const result of sorted) {
      const fullCost = this.config.tokensPerFullResult;
      const compactCost = this.config.tokensPerCompactResult;

      if (
        usedTokens + fullCost <= budget &&
        result.score >= this.config.minScoreForFull
      ) {
        // Keep full
        result.keepFull = true;
        keepFull.push(result);
        usedTokens += fullCost;
      } else if (
        usedTokens + compactCost <= budget &&
        result.score >= this.config.minScoreToKeep &&
        result.compact
      ) {
        // Keep compact
        result.keepFull = false;
        keepCompact.push(result);
        usedTokens += compactCost;
      } else if (usedTokens + compactCost <= budget && result.score >= this.config.minScoreToKeep) {
        // No compact available but score is high enough - keep compact anyway
        // (summarizer should generate one)
        result.keepFull = false;
        keepCompact.push(result);
        usedTokens += compactCost;
      } else {
        // Clear
        result.keepFull = false;
        clear.push(result);
      }
    }

    const originalTokens = sorted.length * this.config.tokensPerFullResult;
    const estimatedTokensSaved = originalTokens - usedTokens;

    return {
      keepFull,
      keepCompact,
      clear,
      estimatedTokensSaved,
    };
  }

  /**
   * Build context string from compaction plan.
   */
  buildContextFromPlan(plan: CompactionPlan): string {
    const sections: string[] = [];

    // Full results
    if (plan.keepFull.length > 0) {
      sections.push('## Tool Results (Full)');
      for (const result of plan.keepFull) {
        sections.push(`\n### ${result.entry.tool}`);
        sections.push(`Args: ${JSON.stringify(result.entry.args)}`);
        sections.push(
          typeof result.entry.result === 'string'
            ? result.entry.result
            : JSON.stringify(result.entry.result, null, 2)
        );
      }
    }

    // Compact results
    if (plan.keepCompact.length > 0) {
      sections.push('\n## Tool Results (Summary)');
      for (const result of plan.keepCompact) {
        if (result.compact) {
          sections.push(
            `- [${result.compact.resultId}] ${result.entry.tool}: ${result.compact.summary}`
          );
        } else {
          sections.push(
            `- ${result.entry.tool}: ${this.quickSummarize(result.entry)}`
          );
        }
      }
    }

    // Cleared results note
    if (plan.clear.length > 0) {
      sections.push(
        `\n_${plan.clear.length} older result(s) cleared from context. Use get_full_result tool to retrieve if needed._`
      );
    }

    return sections.join('\n');
  }

  /**
   * Quick summarize for results without compact representation.
   */
  private quickSummarize(entry: ToolResultEntry): string {
    const resultStr = typeof entry.result === 'string'
      ? entry.result
      : JSON.stringify(entry.result);

    if (resultStr.length <= 100) {
      return resultStr;
    }

    return `${resultStr.slice(0, 100)}... (${resultStr.length} chars)`;
  }

  /**
   * Get score explanation for debugging.
   */
  explainScore(result: ScoredResult): string {
    const { components } = result;
    const lines = [
      `Total Score: ${result.score.toFixed(3)}`,
      `Keep Full: ${result.keepFull}`,
      '',
      'Components:',
      `  Recency: ${components.recency.toFixed(2)} × ${this.config.weights.recency}`,
      `  Query Relevance: ${components.queryRelevance.toFixed(2)} × ${this.config.weights.queryRelevance}`,
      `  Error Signals: ${components.errorSignals.toFixed(2)} × ${this.config.weights.errorSignals}`,
      `  Hypothesis Relevance: ${components.hypothesisRelevance.toFixed(2)} × ${this.config.weights.hypothesisRelevance}`,
      `  Service Relevance: ${components.serviceRelevance.toFixed(2)} × ${this.config.weights.serviceRelevance}`,
      `  Cited in Notes: ${components.citedInNotes.toFixed(2)} × ${this.config.weights.citedInNotes}`,
    ];
    return lines.join('\n');
  }
}

/**
 * Helper to create a configured compactor for different use cases.
 */
export function createCompactor(
  preset: 'incident' | 'research' | 'balanced' = 'balanced'
): ContextCompactor {
  const presets: Record<string, Partial<CompactorConfig>> = {
    incident: {
      // Incident investigation: prioritize errors and hypothesis relevance
      weights: {
        recency: 0.15,
        queryRelevance: 0.15,
        errorSignals: 0.30,
        hypothesisRelevance: 0.20,
        serviceRelevance: 0.10,
        citedInNotes: 0.10,
      },
      maxFullResults: 15,
      minScoreForFull: 0.5,
    },
    research: {
      // Research: prioritize query relevance and recency
      weights: {
        recency: 0.25,
        queryRelevance: 0.30,
        errorSignals: 0.10,
        hypothesisRelevance: 0.10,
        serviceRelevance: 0.10,
        citedInNotes: 0.15,
      },
      maxFullResults: 8,
      minScoreForFull: 0.6,
    },
    balanced: {
      // Default balanced weights
    },
  };

  return new ContextCompactor(presets[preset]);
}
