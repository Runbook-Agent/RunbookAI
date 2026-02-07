# Agent Conversation & Reasoning Design

## Overview

This document details the design for the Runbook AI agent's conversation flow, reasoning system, and hypothesis-driven investigation methodology.

---

## Current Gaps

| Area | Current State | Needed |
|------|--------------|--------|
| Hypothesis Management | Data structures exist, never used | Active lifecycle with LLM |
| Evidence Evaluation | Prompts exist, no parsing | Structured output → hypothesis updates |
| Causal Queries | Builder exists, not integrated | Wire into investigation loop |
| Skill Execution | Executor exists, not called | Invoke from agent when appropriate |
| Conversation Memory | None | Context between turns in chat mode |
| Investigation Phases | Basic loop | State machine with clear phases |
| Structured Output | None | Parse LLM JSON responses |

---

## Proposed Architecture

### 1. Investigation State Machine

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INVESTIGATION PHASES                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐               │
│  │  TRIAGE  │───▶│  HYPOTHESIZE │───▶│  INVESTIGATE │◀──┐           │
│  └──────────┘    └──────────────┘    └──────────────┘   │           │
│       │                                     │           │           │
│       │         - Form 3-5 hypotheses       │           │           │
│       │         - Prioritize by likelihood  │           │           │
│       │         - Generate causal queries   │           │           │
│       │                                     ▼           │           │
│       │                              ┌──────────────┐   │           │
│       │                              │   EVALUATE   │───┘           │
│       │                              └──────────────┘               │
│       │                                     │                       │
│       │         - Classify evidence strength                        │
│       │         - Update hypothesis confidence                      │
│       │         - Branch (strong) or Prune (none)                   │
│       │                                     ▼                       │
│       │                              ┌──────────────┐               │
│       └─────────────────────────────▶│  CONCLUDE    │               │
│                                      └──────────────┘               │
│                                            │                        │
│         - Root cause with confidence       │                        │
│         - Evidence chain                   │                        │
│         - Remediation suggestions          ▼                        │
│                                      ┌──────────────┐               │
│                                      │  REMEDIATE   │               │
│                                      └──────────────┘               │
│                                                                      │
│         - Match to runbooks/skills                                  │
│         - Request approval for mutations                            │
│         - Execute with rollback ready                               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 2. Phase Details

#### Phase 1: TRIAGE
**Goal**: Understand the incident and gather initial context.

```typescript
interface TriageResult {
  incidentSummary: string;
  affectedServices: string[];
  symptoms: string[];
  errorMessages: string[];
  timeWindow: { start: string; end: string };
  severity: 'low' | 'medium' | 'high' | 'critical';
  relatedKnowledge: RetrievedKnowledge;
}
```

**Actions**:
1. Parse incident from PagerDuty/OpsGenie
2. Extract affected services from alert metadata
3. Search knowledge base for similar incidents
4. Retrieve relevant runbooks
5. Set investigation time window

#### Phase 2: HYPOTHESIZE
**Goal**: Form testable hypotheses about root cause.

```typescript
interface HypothesisFormation {
  hypotheses: Array<{
    id: string;
    statement: string;
    category: 'infrastructure' | 'application' | 'dependency' | 'configuration' | 'capacity';
    priority: number;
    confirmingEvidence: string;
    refutingEvidence: string;
    suggestedQueries: CausalQuery[];
  }>;
}
```

**Actions**:
1. Call LLM with structured prompt for hypothesis generation
2. Parse JSON response into hypothesis objects
3. Generate causal queries for each hypothesis using query builder
4. Prioritize by likelihood and severity
5. Store in hypothesis engine

#### Phase 3: INVESTIGATE
**Goal**: Execute targeted queries to test hypotheses.

```typescript
interface InvestigationStep {
  hypothesisId: string;
  query: CausalQuery;
  result: unknown;
  interpretation: string;
}
```

**Actions**:
1. Select highest priority untested hypothesis
2. Execute its causal queries (targeted, not broad)
3. Collect results from tools
4. Move to EVALUATE phase

#### Phase 4: EVALUATE
**Goal**: Assess evidence and update hypothesis state.

```typescript
interface EvidenceEvaluation {
  hypothesisId: string;
  evidenceStrength: 'strong' | 'weak' | 'none' | 'contradicting';
  reasoning: string;
  confidence: number; // 0-100
  action: 'branch' | 'prune' | 'confirm' | 'continue';
}
```

**Actions**:
1. Call LLM to interpret tool results against hypothesis
2. Parse structured response for evidence classification
3. Update hypothesis in engine:
   - **Strong evidence**: Branch into sub-hypotheses OR confirm if specific enough
   - **Weak evidence**: Continue investigation with more queries
   - **No evidence**: Prune hypothesis
   - **Contradicting**: Prune and note counter-evidence
4. Return to INVESTIGATE for next hypothesis, or CONCLUDE if done

#### Phase 5: CONCLUDE
**Goal**: Synthesize findings into root cause determination.

```typescript
interface Conclusion {
  rootCause: string;
  confidence: 'high' | 'medium' | 'low';
  evidenceChain: Array<{
    finding: string;
    source: string;
    strength: string;
  }>;
  alternativeExplanations: string[];
  unknowns: string[];
}
```

**Actions**:
1. Review all hypothesis evaluations
2. Build evidence chain for confirmed hypothesis
3. Determine confidence level
4. Note alternative explanations and unknowns
5. Move to REMEDIATE

#### Phase 6: REMEDIATE
**Goal**: Suggest and execute fixes.

```typescript
interface RemediationPlan {
  steps: Array<{
    action: string;
    command?: string;
    rollback?: string;
    riskLevel: RiskLevel;
    requiresApproval: boolean;
    matchingSkill?: string;
    matchingRunbook?: string;
  }>;
  estimatedRecoveryTime: string;
  monitoring: string[];
}
```

**Actions**:
1. Match root cause to runbooks/skills
2. Generate remediation steps
3. Request approval for mutations
4. Execute with approval flow
5. Suggest monitoring to verify fix

---

### 3. Structured Output Parsing

The LLM should return structured JSON for key decisions:

```typescript
// Hypothesis generation response
interface HypothesisGenerationResponse {
  thinking: string;
  hypotheses: Array<{
    statement: string;
    category: string;
    priority: number;
    confirmingEvidence: string;
    refutingEvidence: string;
  }>;
}

// Evidence evaluation response
interface EvidenceEvaluationResponse {
  thinking: string;
  evaluation: {
    evidenceStrength: 'strong' | 'weak' | 'none' | 'contradicting';
    reasoning: string;
    confidence: number;
    action: 'branch' | 'prune' | 'confirm' | 'continue';
    subHypotheses?: Array<{
      statement: string;
      confirmingEvidence: string;
    }>;
  };
}

// Tool selection response
interface ToolSelectionResponse {
  thinking: string;
  selectedTools: Array<{
    tool: string;
    args: Record<string, unknown>;
    purpose: string;
    hypothesisId?: string;
  }>;
}
```

### 4. Conversation Memory

For chat mode, maintain context between turns:

```typescript
interface ConversationMemory {
  sessionId: string;
  turns: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
  }>;

  // Extracted context
  mentionedServices: string[];
  mentionedIncidents: string[];
  currentInvestigation?: {
    hypotheses: Hypothesis[];
    phase: InvestigationPhase;
  };

  // Summary for context window management
  summary?: string;
  summarizedUpTo?: number; // Turn index
}
```

### 5. Causal Query Integration

Wire the causal query builder into the investigation loop:

```typescript
async function investigateHypothesis(hypothesis: Hypothesis): Promise<InvestigationResult> {
  // 1. Generate causal queries for this hypothesis
  const queries = generateQueriesForHypothesis(hypothesis);

  // 2. Check for broad queries (anti-pattern)
  const refinedQueries = queries.map(q => {
    if (isQueryTooBroad(q)) {
      return suggestQueryRefinements(q, {
        service: extractService(hypothesis),
        timeRange: 30, // minutes
      });
    }
    return q;
  });

  // 3. Prioritize and limit queries
  const prioritized = prioritizeQueries([{
    hypothesisId: hypothesis.id,
    hypothesis: hypothesis.statement,
    queries: refinedQueries,
    priority: 1,
  }], 5); // Max 5 queries per hypothesis

  // 4. Execute queries
  const results = await executeQueries(prioritized);

  // 5. Summarize results for evidence evaluation
  return summarizeQueryResults(prioritized, results);
}
```

### 6. Skill Integration

Invoke skills when appropriate:

```typescript
async function executeRemediation(
  rootCause: Conclusion,
  plan: RemediationPlan
): Promise<RemediationResult> {
  for (const step of plan.steps) {
    // Check if a skill matches
    if (step.matchingSkill) {
      const skill = skillRegistry.get(step.matchingSkill);
      if (skill) {
        const result = await skillExecutor.execute(skill, {
          rootCause: rootCause.rootCause,
          ...step.parameters,
        });

        if (result.status === 'completed') {
          continue;
        } else if (result.status === 'needs_approval') {
          // Wait for approval via CLI or Slack
          const approved = await requestApprovalWithOptions(
            result.pendingApproval,
            { useSlack: true }
          );
          if (!approved.approved) {
            return { status: 'aborted', reason: 'User rejected' };
          }
        }
      }
    }

    // Manual step
    if (step.requiresApproval) {
      // ... approval flow
    }
  }
}
```

---

## Implementation Plan

### Phase 1: Core Reasoning Loop (Priority: HIGH)
1. [ ] Create `InvestigationStateMachine` class
2. [ ] Implement phase transitions with clear triggers
3. [ ] Add structured output parsing for LLM responses
4. [ ] Wire hypothesis engine into investigation loop

### Phase 2: Causal Query Integration (Priority: HIGH)
1. [ ] Integrate `generateQueriesForHypothesis` into INVESTIGATE phase
2. [ ] Add query refinement for broad queries
3. [ ] Implement `executeQueries` with parallel execution
4. [ ] Wire `summarizeQueryResults` into EVALUATE phase

### Phase 3: Evidence Evaluation (Priority: HIGH)
1. [ ] Create evidence evaluation prompt with structured output
2. [ ] Implement confidence scoring algorithm
3. [ ] Add branch/prune/confirm logic
4. [ ] Update hypothesis engine state based on evaluation

### Phase 4: Conversation Memory (Priority: MEDIUM)
1. [ ] Create `ConversationMemory` class
2. [ ] Implement turn tracking with tool calls
3. [ ] Add context summarization for long conversations
4. [ ] Persist memory to scratchpad

### Phase 5: Skill & Runbook Matching (Priority: MEDIUM)
1. [ ] Match root causes to skills using semantic similarity
2. [ ] Match to runbooks using hybrid search
3. [ ] Auto-invoke skills when confidence is high
4. [ ] Suggest runbook steps when no skill matches

### Phase 6: Remediation Flow (Priority: MEDIUM)
1. [ ] Generate remediation plans from conclusions
2. [ ] Integrate approval flow (CLI + Slack)
3. [ ] Execute with rollback tracking
4. [ ] Verify fix with monitoring queries

---

## Example Investigation Flow

```
User: "Investigate incident PD-12345"

=== TRIAGE ===
→ Fetching incident from PagerDuty...
→ Incident: "High latency on checkout-service"
→ Affected services: checkout-service, payment-api, redis-cache
→ Time window: Last 30 minutes
→ Searching knowledge base...
→ Found: 2 runbooks, 1 similar postmortem

=== HYPOTHESIZE ===
→ Generating hypotheses based on symptoms...

Hypotheses formed:
1. [H1] Redis cache is experiencing high memory pressure
   - Confirming: redis memory > 80%, evictions increasing
   - Refuting: memory stable, no evictions

2. [H2] Payment API is timing out on external calls
   - Confirming: payment-api p99 latency > 5s, external errors
   - Refuting: latency normal, no external errors

3. [H3] Database connection pool exhaustion
   - Confirming: connection count at max, wait queue growing
   - Refuting: connections available, no waits

4. [H4] Recent deployment introduced regression
   - Confirming: latency spike correlates with deploy time
   - Refuting: no recent deploys, or metrics stable after deploy

=== INVESTIGATE H1 ===
→ Executing: datadog metrics avg:redis.mem.used{service:checkout}
→ Executing: cloudwatch_logs filter "eviction" in /ecs/redis
→ Results: Memory at 45%, no evictions

=== EVALUATE H1 ===
→ Evidence: NONE
→ Action: PRUNE
→ Reasoning: Redis memory is healthy, no evictions detected

=== INVESTIGATE H2 ===
→ Executing: datadog traces @service:payment-api @duration:>3s
→ Executing: aws_query services=["payment-api"]
→ Results: 23 slow traces, all calling stripe-api

=== EVALUATE H2 ===
→ Evidence: STRONG
→ Action: BRANCH into sub-hypotheses
→ Sub-hypotheses:
  - [H2.1] Stripe API is degraded
  - [H2.2] Network issues to Stripe endpoint
  - [H2.3] Payment-api retry logic causing cascade

=== INVESTIGATE H2.1 ===
→ Executing: Check Stripe status page
→ Executing: datadog metrics avg:payment.stripe.latency
→ Results: Stripe status page shows degraded performance

=== EVALUATE H2.1 ===
→ Evidence: STRONG
→ Action: CONFIRM
→ Reasoning: Stripe status page confirms degradation, matches our latency

=== CONCLUDE ===
Root Cause: Stripe API degradation causing payment-api timeouts
Confidence: HIGH

Evidence chain:
1. checkout-service latency spike at 14:32 UTC
2. 23 slow traces in payment-api, all Stripe calls
3. Stripe status page confirms degraded API performance

=== REMEDIATE ===
Matching runbook: "External Payment Provider Degradation"

Suggested actions:
1. Enable circuit breaker for Stripe calls (requires approval)
2. Notify customers of potential delays
3. Monitor Stripe status page for recovery

Would you like me to execute these steps?
```

---

## Metrics & Observability

Track agent performance:

```typescript
interface AgentMetrics {
  // Investigation quality
  hypothesesFormed: number;
  hypothesesPruned: number;
  hypothesesConfirmed: number;
  averageDepth: number;

  // Efficiency
  toolCallsPerInvestigation: number;
  timeToRootCause: number; // seconds

  // Accuracy (post-incident)
  rootCauseCorrect: boolean; // from postmortem
  remediationEffective: boolean;

  // User experience
  approvalsRequested: number;
  approvalsGranted: number;
  clarificationsNeeded: number;
}
```

---

---

## Log Analysis Capabilities

### Current State
The agent can query logs but lacks intelligent analysis:
- CloudWatch: Filter by pattern
- Datadog: Search with query syntax
- No automatic pattern detection
- No anomaly detection
- No cross-service correlation

### Proposed Log Analysis Features

#### 1. Error Pattern Extraction
Automatically extract and categorize errors from logs:

```typescript
interface LogAnalysis {
  // Extract error patterns
  errorPatterns: Array<{
    pattern: string;           // e.g., "NullPointerException at UserService.java:234"
    count: number;
    firstSeen: string;
    lastSeen: string;
    sampleMessages: string[];
    affectedServices: string[];
  }>;

  // Detect anomalies
  anomalies: Array<{
    type: 'spike' | 'new_error' | 'missing_logs' | 'pattern_change';
    description: string;
    severity: 'low' | 'medium' | 'high';
    timeWindow: { start: string; end: string };
  }>;

  // Timeline of events
  timeline: Array<{
    timestamp: string;
    event: string;
    service: string;
    severity: string;
  }>;
}
```

#### 2. Smart Log Queries
Generate targeted log queries based on hypothesis:

```typescript
function generateLogQueries(hypothesis: Hypothesis): LogQuery[] {
  const patterns = detectPatterns(hypothesis.statement);

  // For "database connection timeout" hypothesis:
  return [
    {
      source: 'cloudwatch',
      logGroup: '/ecs/api-service',
      patterns: ['timeout', 'connection refused', 'pool exhausted'],
      timeRange: 30, // minutes
    },
    {
      source: 'datadog',
      query: 'service:api-service @error_type:database',
      facets: ['@db.host', '@error.message'],
    }
  ];
}
```

#### 3. Log Correlation
Correlate events across services:

```typescript
interface CorrelatedEvents {
  traceId?: string;
  events: Array<{
    timestamp: string;
    service: string;
    message: string;
    level: string;
  }>;
  rootEvent?: {
    service: string;
    message: string;
    timestamp: string;
  };
  propagationPath: string[]; // e.g., ["api", "auth", "database"]
}

async function correlateLogEvents(
  timeWindow: { start: Date; end: Date },
  services: string[]
): Promise<CorrelatedEvents[]> {
  // 1. Fetch logs from all services
  // 2. Extract trace IDs or request IDs
  // 3. Group events by trace
  // 4. Order by timestamp
  // 5. Identify root cause event
}
```

#### 4. Anomaly Detection
Detect unusual patterns in logs:

```typescript
interface LogAnomalyDetector {
  // Compare current error rate to baseline
  detectErrorSpike(
    service: string,
    windowMinutes: number
  ): Promise<{
    isAnomaly: boolean;
    currentRate: number;
    baselineRate: number;
    percentIncrease: number;
  }>;

  // Detect new error types
  detectNewErrors(
    service: string,
    sinceMinutes: number
  ): Promise<Array<{
    errorType: string;
    firstSeen: string;
    count: number;
    sampleMessage: string;
  }>>;

  // Detect missing expected logs
  detectMissingLogs(
    service: string,
    expectedPattern: string,
    intervalMinutes: number
  ): Promise<{
    isMissing: boolean;
    lastSeen: string;
    expectedInterval: number;
  }>;
}
```

#### 5. LLM-Powered Log Summarization
Use LLM to summarize log findings:

```typescript
async function summarizeLogs(
  logs: LogEntry[],
  context: { hypothesis: string; service: string }
): Promise<{
  summary: string;
  keyFindings: string[];
  evidenceStrength: 'strong' | 'weak' | 'none';
  suggestedNextSteps: string[];
}> {
  const prompt = `Analyze these logs in context of investigating: "${context.hypothesis}"

Logs from ${context.service}:
${formatLogs(logs)}

Provide:
1. Brief summary of what the logs show
2. Key findings relevant to the hypothesis
3. Evidence strength (strong/weak/none)
4. Suggested next investigation steps`;

  return parseLLMResponse(await llm.chat(prompt));
}
```

### Implementation Priority

| Feature | Priority | Complexity | Value |
|---------|----------|------------|-------|
| Error pattern extraction | HIGH | Medium | High |
| LLM log summarization | HIGH | Low | High |
| Targeted log queries | HIGH | Low | Medium |
| Cross-service correlation | MEDIUM | High | High |
| Anomaly detection | MEDIUM | Medium | Medium |
| Log timeline visualization | LOW | Medium | Medium |

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/agent/state-machine.ts` | Create | Investigation state machine |
| `src/agent/reasoning.ts` | Create | Structured reasoning with LLM |
| `src/agent/memory.ts` | Create | Conversation memory |
| `src/agent/evidence.ts` | Create | Evidence evaluation logic |
| `src/agent/remediation.ts` | Create | Remediation planning |
| `src/agent/log-analyzer.ts` | Create | Log analysis and pattern extraction |
| `src/agent/agent.ts` | Modify | Integrate new components |
| `src/agent/prompts.ts` | Modify | Add structured output prompts |
