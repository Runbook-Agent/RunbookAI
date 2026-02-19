import { describe, it, expect } from 'vitest';
import { ToolSummarizer } from '../tool-summarizer';

describe('ToolSummarizer aws_query', () => {
  it('includes Lambda function names in compact summaries', () => {
    const summarizer = new ToolSummarizer();

    const compact = summarizer.summarize(
      'aws_query',
      { query: 'Show lambda functions' },
      {
        totalResources: 1,
        servicesQueried: 1,
        results: {
          lambda: {
            count: 1,
            resources: [
              {
                id: 'arn:aws:lambda:ap-south-1:123456789012:function:runbook-yc-demo-failing-worker',
                name: 'runbook-yc-demo-failing-worker',
                status: 'Active',
              },
            ],
          },
        },
      }
    );

    expect(compact.summary).toContain('lambda/runbook-yc-demo-failing-worker');
    expect(compact.services).toContain('runbook-yc-demo-failing-worker');

    const lambdaHighlights = compact.highlights.lambda as { notable?: string[] };
    expect(lambdaHighlights.notable).toContain('runbook-yc-demo-failing-worker');
  });

  it('extracts Lambda function names from ARN when name field is missing', () => {
    const summarizer = new ToolSummarizer();

    const compact = summarizer.summarize(
      'aws_query',
      { query: 'Show lambda functions' },
      {
        totalResources: 1,
        servicesQueried: 1,
        results: {
          lambda: {
            count: 1,
            resources: [
              {
                id: 'arn:aws:lambda:ap-south-1:123456789012:function:worker-from-arn-only',
                status: 'Active',
              },
            ],
          },
        },
      }
    );

    expect(compact.summary).toContain('lambda/worker-from-arn-only');
    expect(compact.services).toContain('worker-from-arn-only');
  });
});

describe('ToolSummarizer kubernetes_query', () => {
  it('summarizes unhealthy pod state to keep prompts compact', () => {
    const summarizer = new ToolSummarizer();

    const compact = summarizer.summarize(
      'kubernetes_query',
      { action: 'pods', namespace: 'prod' },
      {
        pods: [
          { name: 'checkout-api-123', status: 'Running' },
          { name: 'checkout-worker-456', status: 'CrashLoopBackOff' },
        ],
        count: 2,
        namespace: 'prod',
      }
    );

    expect(compact.summary).toContain('2 total, 1 non-running');
    expect(compact.hasErrors).toBe(true);
    expect(compact.healthStatus).toBe('degraded');
    expect(compact.itemCount).toBe(2);
  });
});

describe('ToolSummarizer code fix providers', () => {
  it('summarizes github fix candidates with type counts', () => {
    const summarizer = new ToolSummarizer();

    const compact = summarizer.summarize(
      'github_query',
      { query: 'checkout timeout rollback' },
      {
        provider: 'github',
        query: 'checkout timeout rollback',
        repository: 'acme/platform',
        candidates: [
          {
            provider: 'github',
            type: 'pull_request',
            title: 'Rollback retry logic',
            url: 'https://github.com/acme/platform/pull/123',
          },
          {
            provider: 'github',
            type: 'code',
            title: 'retry.ts',
            path: 'src/retry.ts',
            url: 'https://github.com/acme/platform/blob/main/src/retry.ts',
          },
        ],
      }
    );

    expect(compact.summary).toContain('GitHub fix candidates');
    expect(compact.itemCount).toBe(2);
    expect(compact.hasErrors).toBe(false);
    expect(compact.highlights.byType).toEqual({ pull_request: 1, code: 1 });
  });
});

describe('ToolSummarizer incident providers', () => {
  it('summarizes opsgenie incident severity and impacted services', () => {
    const summarizer = new ToolSummarizer();

    const compact = summarizer.summarize(
      'opsgenie_get_incident',
      {},
      {
        incident: {
          id: 'inc-1',
          message: 'Checkout latency spike',
          status: 'open',
          priority: 'P1',
          impactedServices: ['checkout-api', 'cart-service'],
        },
      }
    );

    expect(compact.summary).toContain('Checkout latency spike');
    expect(compact.hasErrors).toBe(true);
    expect(compact.healthStatus).toBe('critical');
    expect(compact.services).toContain('checkout-api');
    expect(compact.services).toContain('cart-service');
  });
});
