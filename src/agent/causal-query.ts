/**
 * Causal Query Builder
 *
 * Generates targeted queries based on hypotheses rather than broad data gathering.
 * Implements the Bits AI methodology of hypothesis-driven investigation.
 */

import type { Hypothesis } from './types';

export interface CausalQuery {
  id: string;
  hypothesisId: string;
  queryType: 'confirming' | 'refuting' | 'exploratory';
  tool: string;
  parameters: Record<string, unknown>;
  expectedOutcome: string;
  relevanceScore: number;
}

export interface QueryPlan {
  hypothesisId: string;
  hypothesis: string;
  queries: CausalQuery[];
  priority: number;
}

/**
 * Common failure patterns and their investigation queries
 */
const FAILURE_PATTERNS: Record<
  string,
  {
    keywords: string[];
    queries: Array<{
      tool: string;
      parameters: Record<string, unknown>;
      description: string;
    }>;
  }
> = {
  high_latency: {
    keywords: ['latency', 'slow', 'timeout', 'delay', 'response time', 'p99', 'p95'],
    queries: [
      {
        tool: 'cloudwatch_logs',
        parameters: { filter_pattern: 'duration timeout slow' },
        description: 'Search for slow request logs',
      },
      {
        tool: 'datadog',
        parameters: { action: 'traces', query: '@duration:>1000000000' },
        description: 'Find slow traces in APM',
      },
      {
        tool: 'aws_query',
        parameters: { services: ['rds', 'elasticache', 'dynamodb'] },
        description: 'Check database performance',
      },
    ],
  },

  high_error_rate: {
    keywords: ['error', '5xx', '500', 'exception', 'failure', 'failed', 'crash'],
    queries: [
      {
        tool: 'cloudwatch_logs',
        parameters: { filter_pattern: 'ERROR Exception Traceback' },
        description: 'Search for error logs',
      },
      {
        tool: 'datadog',
        parameters: { action: 'logs', query: 'status:error' },
        description: 'Find error logs in Datadog',
      },
      {
        tool: 'cloudwatch_alarms',
        parameters: { state: 'ALARM' },
        description: 'Check for error rate alarms',
      },
    ],
  },

  memory_issues: {
    keywords: ['memory', 'oom', 'out of memory', 'heap', 'gc', 'garbage collection'],
    queries: [
      {
        tool: 'cloudwatch_logs',
        parameters: { filter_pattern: 'OutOfMemory oom killed memory' },
        description: 'Search for OOM events',
      },
      {
        tool: 'datadog',
        parameters: { action: 'metrics', query: 'avg:system.mem.used{*}' },
        description: 'Check memory usage metrics',
      },
      {
        tool: 'aws_query',
        parameters: { services: ['ecs', 'lambda'] },
        description: 'Check container/function memory config',
      },
    ],
  },

  cpu_issues: {
    keywords: ['cpu', 'throttle', 'throttling', 'high cpu', 'processor'],
    queries: [
      {
        tool: 'datadog',
        parameters: { action: 'metrics', query: 'avg:system.cpu.user{*}' },
        description: 'Check CPU usage metrics',
      },
      {
        tool: 'cloudwatch_alarms',
        parameters: { state: 'ALARM' },
        description: 'Check for CPU alarms',
      },
      {
        tool: 'aws_query',
        parameters: { services: ['ecs', 'ec2', 'lambda'] },
        description: 'Check compute resource status',
      },
    ],
  },

  connectivity_issues: {
    keywords: ['connection', 'network', 'dns', 'unreachable', 'refused', 'timeout'],
    queries: [
      {
        tool: 'cloudwatch_logs',
        parameters: { filter_pattern: 'connection refused timeout unreachable' },
        description: 'Search for connection errors',
      },
      {
        tool: 'aws_query',
        parameters: { services: ['elb', 'vpc'] },
        description: 'Check load balancer and VPC status',
      },
      {
        tool: 'datadog',
        parameters: { action: 'monitors' },
        description: 'Check network-related monitors',
      },
    ],
  },

  deployment_issues: {
    keywords: ['deploy', 'release', 'rollout', 'version', 'update', 'change'],
    queries: [
      {
        tool: 'aws_query',
        parameters: { services: ['ecs', 'lambda', 'codepipeline'] },
        description: 'Check recent deployments',
      },
      {
        tool: 'datadog',
        parameters: { action: 'events' },
        description: 'Check deployment events',
      },
      {
        tool: 'search_knowledge',
        parameters: { type_filter: ['postmortem'] },
        description: 'Check for similar past incidents',
      },
    ],
  },

  database_issues: {
    keywords: ['database', 'db', 'query', 'sql', 'deadlock', 'connection pool'],
    queries: [
      {
        tool: 'aws_query',
        parameters: { services: ['rds', 'dynamodb', 'elasticache'] },
        description: 'Check database status',
      },
      {
        tool: 'cloudwatch_logs',
        parameters: { filter_pattern: 'deadlock timeout connection pool' },
        description: 'Search for database errors',
      },
      {
        tool: 'datadog',
        parameters: { action: 'metrics', query: 'avg:aws.rds.database_connections{*}' },
        description: 'Check database connection metrics',
      },
    ],
  },

  scaling_issues: {
    keywords: ['scale', 'capacity', 'throttle', 'limit', 'quota', 'max'],
    queries: [
      {
        tool: 'aws_query',
        parameters: { services: ['ecs', 'lambda', 'ec2'] },
        description: 'Check current capacity',
      },
      {
        tool: 'cloudwatch_alarms',
        parameters: { state: 'ALARM' },
        description: 'Check for scaling alarms',
      },
      {
        tool: 'datadog',
        parameters: { action: 'metrics', query: 'avg:aws.ecs.service.running{*}' },
        description: 'Check scaling metrics',
      },
    ],
  },
};

/**
 * Generate a unique query ID
 */
function generateQueryId(): string {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Detect failure patterns from hypothesis statement
 */
function detectPatterns(hypothesis: string): string[] {
  const lowerHypothesis = hypothesis.toLowerCase();
  const detectedPatterns: string[] = [];

  for (const [pattern, config] of Object.entries(FAILURE_PATTERNS)) {
    for (const keyword of config.keywords) {
      if (lowerHypothesis.includes(keyword)) {
        if (!detectedPatterns.includes(pattern)) {
          detectedPatterns.push(pattern);
        }
        break;
      }
    }
  }

  return detectedPatterns;
}

/**
 * Generate causal queries for a hypothesis
 */
export function generateQueriesForHypothesis(hypothesis: Hypothesis): CausalQuery[] {
  const queries: CausalQuery[] = [];
  const patterns = detectPatterns(hypothesis.statement);

  // Add pattern-specific queries
  for (const pattern of patterns) {
    const patternConfig = FAILURE_PATTERNS[pattern];
    if (!patternConfig) continue;

    for (const queryTemplate of patternConfig.queries) {
      queries.push({
        id: generateQueryId(),
        hypothesisId: hypothesis.id,
        queryType: 'confirming',
        tool: queryTemplate.tool,
        parameters: { ...queryTemplate.parameters },
        expectedOutcome: queryTemplate.description,
        relevanceScore: 0.8,
      });
    }
  }

  // If no patterns detected, add generic investigative queries
  if (queries.length === 0) {
    queries.push(
      {
        id: generateQueryId(),
        hypothesisId: hypothesis.id,
        queryType: 'exploratory',
        tool: 'cloudwatch_alarms',
        parameters: { state: 'ALARM' },
        expectedOutcome: 'Check for any active alarms',
        relevanceScore: 0.5,
      },
      {
        id: generateQueryId(),
        hypothesisId: hypothesis.id,
        queryType: 'exploratory',
        tool: 'cloudwatch_logs',
        parameters: { filter_pattern: 'ERROR' },
        expectedOutcome: 'Search for recent errors',
        relevanceScore: 0.5,
      },
      {
        id: generateQueryId(),
        hypothesisId: hypothesis.id,
        queryType: 'exploratory',
        tool: 'datadog',
        parameters: { action: 'monitors' },
        expectedOutcome: 'Check for triggered monitors',
        relevanceScore: 0.5,
      }
    );
  }

  return queries;
}

/**
 * Generate a query plan for multiple hypotheses
 */
export function generateQueryPlan(hypotheses: Hypothesis[]): QueryPlan[] {
  const plans: QueryPlan[] = [];

  // Sort hypotheses by evidence strength (pending/none first = higher priority to investigate)
  const strengthOrder: Record<string, number> = { pending: 0, none: 1, weak: 2, strong: 3 };
  const sortedHypotheses = [...hypotheses].sort((a, b) => {
    const aScore = strengthOrder[a.evidenceStrength] ?? 0;
    const bScore = strengthOrder[b.evidenceStrength] ?? 0;
    return aScore - bScore;
  });

  for (let i = 0; i < sortedHypotheses.length; i++) {
    const hypothesis = sortedHypotheses[i];
    if (hypothesis.status === 'pruned') continue;

    const queries = generateQueriesForHypothesis(hypothesis);

    plans.push({
      hypothesisId: hypothesis.id,
      hypothesis: hypothesis.statement,
      queries,
      priority: i + 1,
    });
  }

  return plans;
}

/**
 * Anti-pattern detection: Check if a query is too broad
 */
export function isQueryTooBroad(query: CausalQuery): boolean {
  const broadPatterns = [
    // Queries without filters
    {
      tool: 'aws_query',
      check: (p: Record<string, unknown>) =>
        !p.services || (p.services as string[]).includes('all'),
    },
    // Log queries without specific patterns
    { tool: 'cloudwatch_logs', check: (p: Record<string, unknown>) => !p.filter_pattern },
    // Datadog queries without filters
    { tool: 'datadog', check: (p: Record<string, unknown>) => p.action === 'logs' && !p.query },
  ];

  for (const pattern of broadPatterns) {
    if (query.tool === pattern.tool && pattern.check(query.parameters)) {
      return true;
    }
  }

  return false;
}

/**
 * Suggest refinements for broad queries
 */
export function suggestQueryRefinements(
  query: CausalQuery,
  context: {
    service?: string;
    timeRange?: number;
    errorType?: string;
  }
): CausalQuery {
  const refined = { ...query, parameters: { ...query.parameters } };

  if (query.tool === 'cloudwatch_logs' && !query.parameters.filter_pattern) {
    refined.parameters.filter_pattern = context.errorType || 'ERROR Exception';
  }

  if (
    query.tool === 'aws_query' &&
    (!query.parameters.services || (query.parameters.services as string[]).includes('all'))
  ) {
    refined.parameters.services = ['ecs', 'lambda', 'rds']; // Default to common services
  }

  if (query.tool === 'datadog' && query.parameters.action === 'logs' && !query.parameters.query) {
    refined.parameters.query = context.service
      ? `service:${context.service} status:error`
      : 'status:error';
  }

  if (context.timeRange) {
    refined.parameters.from_minutes = context.timeRange;
    refined.parameters.minutes_back = context.timeRange;
  }

  return refined;
}

/**
 * Prioritize queries based on hypothesis confidence and query relevance
 */
export function prioritizeQueries(plans: QueryPlan[], maxQueries: number = 10): CausalQuery[] {
  const allQueries: Array<CausalQuery & { priority: number }> = [];

  for (const plan of plans) {
    for (const query of plan.queries) {
      allQueries.push({
        ...query,
        priority: plan.priority,
      });
    }
  }

  // Sort by priority (lower is better) and relevance score (higher is better)
  allQueries.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return b.relevanceScore - a.relevanceScore;
  });

  // Deduplicate by tool + parameters
  const seen = new Set<string>();
  const unique: CausalQuery[] = [];

  for (const query of allQueries) {
    const key = `${query.tool}:${JSON.stringify(query.parameters)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(query);
    }
  }

  return unique.slice(0, maxQueries);
}

/**
 * Generate investigation summary from query results
 */
export function summarizeQueryResults(
  queries: CausalQuery[],
  results: Map<string, unknown>
): {
  confirming: string[];
  refuting: string[];
  inconclusive: string[];
} {
  const summary = {
    confirming: [] as string[],
    refuting: [] as string[],
    inconclusive: [] as string[],
  };

  for (const query of queries) {
    const result = results.get(query.id);

    if (!result) {
      summary.inconclusive.push(`${query.tool}: No result`);
      continue;
    }

    // Analyze result based on query type
    const resultStr = JSON.stringify(result);
    const hasData = resultStr.length > 50; // Simple heuristic
    const hasErrors = resultStr.toLowerCase().includes('error');

    if (query.queryType === 'confirming') {
      if (hasData) {
        summary.confirming.push(`${query.tool}: ${query.expectedOutcome} - Found evidence`);
      } else {
        summary.refuting.push(`${query.tool}: ${query.expectedOutcome} - No evidence found`);
      }
    } else if (query.queryType === 'refuting') {
      if (hasData) {
        summary.refuting.push(`${query.tool}: ${query.expectedOutcome} - Found counter-evidence`);
      } else {
        summary.confirming.push(`${query.tool}: ${query.expectedOutcome} - No counter-evidence`);
      }
    } else {
      if (hasErrors) {
        summary.confirming.push(`${query.tool}: Found potential issues`);
      } else {
        summary.inconclusive.push(`${query.tool}: ${query.expectedOutcome}`);
      }
    }
  }

  return summary;
}
