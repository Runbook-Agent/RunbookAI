/**
 * Scratchpad: Single source of truth for all agent work
 *
 * Persists as JSONL for auditability and implements graceful limits
 * to prevent retry loops without blocking the agent.
 *
 * Supports tiered storage:
 * - Full: Complete tool results in context
 * - Compact: Summarized results for token efficiency
 * - Cleared: Results removed from context but available via get_full_result
 */

import { mkdir, appendFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { ScratchpadEntry, ToolResultEntry } from './types';
import type { CompactToolResult } from './tool-summarizer';
import type { CompactionPlan, ScoredResult } from './context-compactor';

interface ToolUsageStats {
  callCount: number;
  queries: string[];
}

interface ToolLimitResult {
  allowed: boolean;
  warning?: string;
}

/**
 * Storage tier for a tool result.
 */
export type StorageTier = 'full' | 'compact' | 'cleared';

/**
 * Extended tool result with tiered storage metadata.
 */
export interface TieredToolResult extends ToolResultEntry {
  /** Unique result ID for drill-down retrieval */
  resultId: string;
  /** Current storage tier */
  tier: StorageTier;
  /** Compact summary if available */
  compact?: CompactToolResult;
  /** Importance score from compaction (0-1) */
  importanceScore?: number;
}

export class Scratchpad {
  private entries: ScratchpadEntry[] = [];
  private toolUsage: Map<string, ToolUsageStats> = new Map();
  private filePath: string;
  private initialized = false;

  /** Tiered tool results with storage metadata */
  private tieredResults: Map<string, TieredToolResult> = new Map();
  /** Result ID counter for generating unique IDs */
  private resultIdCounter = 0;
  /** Full results preserved for drill-down (cleared from context) */
  private archivedResults: Map<string, ToolResultEntry> = new Map();

  constructor(
    private readonly baseDir: string,
    private readonly sessionId: string,
    private readonly toolLimits: Record<string, number> = {}
  ) {
    this.filePath = join(baseDir, `${sessionId}.jsonl`);
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    // Ensure directory exists
    if (!existsSync(this.baseDir)) {
      await mkdir(this.baseDir, { recursive: true });
    }

    this.initialized = true;
  }

  /**
   * Append an entry to the scratchpad
   */
  async append(entry: Record<string, unknown> & { type: string }): Promise<void> {
    await this.init();

    const fullEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    } as ScratchpadEntry;

    this.entries.push(fullEntry);

    // Track tool usage for limits
    if (fullEntry.type === 'tool_result') {
      this.trackToolUsage(fullEntry as ToolResultEntry);
    }

    // Persist to JSONL
    await appendFile(this.filePath, JSON.stringify(fullEntry) + '\n');
  }

  /**
   * Append a tool result with tiered storage support.
   * Returns the generated result ID for reference.
   */
  async appendToolResult(
    entry: Omit<ToolResultEntry, 'type' | 'timestamp'>,
    options: {
      compact?: CompactToolResult;
      tier?: StorageTier;
    } = {}
  ): Promise<string> {
    await this.init();

    // Generate unique result ID
    const resultId = this.generateResultId(entry.tool);

    const fullEntry: TieredToolResult = {
      ...entry,
      type: 'tool_result',
      timestamp: new Date().toISOString(),
      resultId,
      tier: options.tier || 'full',
      compact: options.compact,
    };

    this.entries.push(fullEntry);
    this.tieredResults.set(resultId, fullEntry);

    // Track tool usage for limits
    this.trackToolUsage(fullEntry);

    // Persist to JSONL (with resultId for later retrieval)
    await appendFile(this.filePath, JSON.stringify(fullEntry) + '\n');

    return resultId;
  }

  /**
   * Generate a unique result ID.
   */
  private generateResultId(toolName: string): string {
    this.resultIdCounter++;
    const toolPrefix = toolName.slice(0, 3).toLowerCase();
    const timestamp = Date.now().toString(36).slice(-4);
    const counter = this.resultIdCounter.toString(36).padStart(2, '0');
    return `${toolPrefix}-${timestamp}${counter}`;
  }

  /**
   * Track tool usage for graceful limits
   */
  private trackToolUsage(entry: ToolResultEntry): void {
    const stats = this.toolUsage.get(entry.tool) || { callCount: 0, queries: [] };
    stats.callCount++;

    // Extract query-like args for similarity detection
    const queryArg =
      entry.args.query || entry.args.search || entry.args.filter || JSON.stringify(entry.args);
    if (typeof queryArg === 'string') {
      stats.queries.push(queryArg);
    }

    this.toolUsage.set(entry.tool, stats);
  }

  /**
   * Check if a tool call should proceed (graceful limits)
   *
   * Always returns allowed: true, but may include warnings
   */
  canCallTool(toolName: string, query?: string): ToolLimitResult {
    const limit = this.toolLimits[toolName] || 5; // Default limit
    const stats = this.toolUsage.get(toolName);

    if (!stats) {
      return { allowed: true };
    }

    // Check if over suggested limit
    if (stats.callCount >= limit) {
      return {
        allowed: true, // Never block, only warn
        warning: `Tool "${toolName}" has been called ${stats.callCount} times (suggested limit: ${limit}). Consider if additional calls are necessary.`,
      };
    }

    // Check for similar queries (potential retry loop)
    if (query && stats.queries.length > 0) {
      const similarity = this.maxSimilarity(query, stats.queries);
      if (similarity > 0.8) {
        return {
          allowed: true,
          warning: `Query appears similar to a previous "${toolName}" call (${Math.round(similarity * 100)}% similarity). This might be a retry loop.`,
        };
      }
    }

    // Approaching limit warning
    if (stats.callCount === limit - 1) {
      return {
        allowed: true,
        warning: `Approaching suggested limit for "${toolName}" (${stats.callCount + 1}/${limit} calls).`,
      };
    }

    return { allowed: true };
  }

  /**
   * Calculate Jaccard similarity between query and previous queries
   */
  private maxSimilarity(query: string, previousQueries: string[]): number {
    const queryWords = new Set(query.toLowerCase().split(/\s+/));
    let maxSim = 0;

    for (const prev of previousQueries) {
      const prevWords = new Set(prev.toLowerCase().split(/\s+/));
      const intersection = new Set([...queryWords].filter((w) => prevWords.has(w)));
      const union = new Set([...queryWords, ...prevWords]);
      const similarity = intersection.size / union.size;
      maxSim = Math.max(maxSim, similarity);
    }

    return maxSim;
  }

  /**
   * Get all tool results for context building
   */
  getToolResults(): ToolResultEntry[] {
    return this.entries.filter((e): e is ToolResultEntry => e.type === 'tool_result');
  }

  /**
   * Get recent tool results (for context window management)
   */
  getRecentToolResults(count: number): ToolResultEntry[] {
    const toolResults = this.getToolResults();
    return toolResults.slice(-count);
  }

  /**
   * Clear oldest tool results (keep in JSONL, remove from memory)
   * Returns count of cleared entries
   */
  clearOldestToolResults(keepCount: number): number {
    const toolResults = this.getToolResults();
    const clearCount = Math.max(0, toolResults.length - keepCount);

    if (clearCount > 0) {
      // Mark entries as cleared in memory (JSONL is never modified)
      let cleared = 0;
      this.entries = this.entries.filter((entry) => {
        if (entry.type === 'tool_result' && cleared < clearCount) {
          cleared++;
          return false;
        }
        return true;
      });
    }

    return clearCount;
  }

  /**
   * Apply a compaction plan from ContextCompactor.
   * Updates tiers and archives cleared results for later retrieval.
   */
  applyCompactionPlan(plan: CompactionPlan): {
    fullCount: number;
    compactCount: number;
    clearedCount: number;
  } {
    // Update results to keep full
    for (const scored of plan.keepFull) {
      const resultId = (scored.entry as TieredToolResult).resultId;
      if (resultId && this.tieredResults.has(resultId)) {
        const result = this.tieredResults.get(resultId)!;
        result.tier = 'full';
        result.importanceScore = scored.score;
      }
    }

    // Update results to keep compact
    for (const scored of plan.keepCompact) {
      const resultId = (scored.entry as TieredToolResult).resultId;
      if (resultId && this.tieredResults.has(resultId)) {
        const result = this.tieredResults.get(resultId)!;
        result.tier = 'compact';
        result.compact = scored.compact;
        result.importanceScore = scored.score;
      }
    }

    // Clear results (archive for later retrieval)
    for (const scored of plan.clear) {
      const resultId = (scored.entry as TieredToolResult).resultId;
      if (resultId && this.tieredResults.has(resultId)) {
        const result = this.tieredResults.get(resultId)!;
        result.tier = 'cleared';
        result.importanceScore = scored.score;

        // Archive the full result for later retrieval
        this.archivedResults.set(resultId, {
          type: 'tool_result',
          tool: result.tool,
          args: result.args,
          result: result.result,
          durationMs: result.durationMs,
          timestamp: result.timestamp,
        });
      }
    }

    return {
      fullCount: plan.keepFull.length,
      compactCount: plan.keepCompact.length,
      clearedCount: plan.clear.length,
    };
  }

  /**
   * Get a full result by ID (works for both active and archived results).
   */
  getResultById(resultId: string): ToolResultEntry | null {
    // Check active tiered results first
    const tiered = this.tieredResults.get(resultId);
    if (tiered) {
      return {
        type: 'tool_result',
        tool: tiered.tool,
        args: tiered.args,
        result: tiered.result,
        durationMs: tiered.durationMs,
        timestamp: tiered.timestamp,
      };
    }

    // Check archived results
    const archived = this.archivedResults.get(resultId);
    if (archived) {
      return archived;
    }

    return null;
  }

  /**
   * Check if a result ID exists.
   */
  hasResult(resultId: string): boolean {
    return this.tieredResults.has(resultId) || this.archivedResults.has(resultId);
  }

  /**
   * Get all result IDs.
   */
  getResultIds(): string[] {
    return [
      ...Array.from(this.tieredResults.keys()),
      ...Array.from(this.archivedResults.keys()),
    ];
  }

  /**
   * Get tiered tool results by tier.
   */
  getResultsByTier(tier: StorageTier): TieredToolResult[] {
    return Array.from(this.tieredResults.values()).filter(r => r.tier === tier);
  }

  /**
   * Get all tiered results for context building.
   */
  getTieredResults(): TieredToolResult[] {
    return Array.from(this.tieredResults.values());
  }

  /**
   * Build context string from tiered results.
   * Includes full results, compact summaries, and notes about cleared results.
   */
  buildTieredContext(): string {
    const sections: string[] = [];
    const fullResults = this.getResultsByTier('full');
    const compactResults = this.getResultsByTier('compact');
    const clearedCount = this.getResultsByTier('cleared').length;

    // Extract auto-generated visualizations and display them FIRST
    const autoVisualizations: string[] = [];
    for (const result of fullResults) {
      if (result.result && typeof result.result === 'object') {
        const resultObj = result.result as Record<string, unknown>;
        if (resultObj.autoVisualization) {
          autoVisualizations.push(resultObj.autoVisualization as string);
        }
      }
    }

    if (autoVisualizations.length > 0) {
      for (const viz of autoVisualizations) {
        sections.push(viz);
        sections.push('');
      }
    }

    // Full results
    if (fullResults.length > 0) {
      sections.push('## Tool Results\n');
      for (const result of fullResults) {
        sections.push(`### ${result.tool} [${result.resultId}]`);
        sections.push(`Args: ${JSON.stringify(result.args)}`);
        const resultStr = typeof result.result === 'string'
          ? result.result
          : JSON.stringify(result.result, null, 2);
        sections.push(resultStr.slice(0, 3000)); // Limit size per result
        sections.push('');
      }
    }

    // Compact results
    if (compactResults.length > 0) {
      sections.push('\n## Tool Results (Summary)\n');
      for (const result of compactResults) {
        if (result.compact) {
          sections.push(`- [${result.resultId}] ${result.tool}: ${result.compact.summary}`);
          if (result.compact.services.length > 0) {
            sections.push(`  Services: ${result.compact.services.slice(0, 5).join(', ')}`);
          }
        } else {
          const preview = typeof result.result === 'string'
            ? result.result.slice(0, 100)
            : JSON.stringify(result.result).slice(0, 100);
          sections.push(`- [${result.resultId}] ${result.tool}: ${preview}...`);
        }
      }
    }

    // Note about cleared results
    if (clearedCount > 0) {
      sections.push(`\n_${clearedCount} older result(s) cleared. Use get_full_result with result ID to retrieve._`);
    }

    return sections.join('\n');
  }

  /**
   * Get compact result for a specific result ID.
   */
  getCompactResult(resultId: string): CompactToolResult | null {
    const result = this.tieredResults.get(resultId);
    return result?.compact || null;
  }

  /**
   * Set compact summary for a result.
   */
  setCompactResult(resultId: string, compact: CompactToolResult): void {
    const result = this.tieredResults.get(resultId);
    if (result) {
      result.compact = compact;
    }
  }

  /**
   * Get count of results by tier.
   */
  getResultCounts(): { full: number; compact: number; cleared: number; archived: number } {
    return {
      full: this.getResultsByTier('full').length,
      compact: this.getResultsByTier('compact').length,
      cleared: this.getResultsByTier('cleared').length,
      archived: this.archivedResults.size,
    };
  }

  /**
   * Get tool usage status for prompt injection
   */
  getToolUsageStatus(): string {
    const lines: string[] = [];

    for (const [tool, stats] of this.toolUsage) {
      const limit = this.toolLimits[tool] || 5;
      const status = stats.callCount >= limit ? '(at limit)' : '';
      lines.push(`- ${tool}: ${stats.callCount}/${limit} calls ${status}`);
    }

    return lines.length > 0 ? lines.join('\n') : 'No tools called yet.';
  }

  /**
   * Get all entries (for investigation summary)
   */
  getAllEntries(): ScratchpadEntry[] {
    return [...this.entries];
  }

  /**
   * Load existing scratchpad from file
   */
  async load(): Promise<void> {
    await this.init();

    if (!existsSync(this.filePath)) {
      return;
    }

    const content = await readFile(this.filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as ScratchpadEntry;
        this.entries.push(entry);

        if (entry.type === 'tool_result') {
          this.trackToolUsage(entry);
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  /**
   * Get the file path for this scratchpad
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Generate a unique session ID
   */
  static generateSessionId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}_${random}`;
  }
}
