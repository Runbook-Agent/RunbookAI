import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '../../agent/types';
import { DEFAULT_CONFIG, type Config } from '../../utils/config';

const mocks = vi.hoisted(() => ({
  loadServiceConfig: vi.fn(),
  isPrometheusConfigured: vi.fn(),
}));

vi.mock('../../config/onboarding', () => ({
  loadServiceConfig: mocks.loadServiceConfig,
}));

vi.mock('../../tools/observability/prometheus', async () => {
  const actual = await vi.importActual<typeof import('../../tools/observability/prometheus')>(
    '../../tools/observability/prometheus'
  );
  return {
    ...actual,
    isPrometheusConfigured: mocks.isPrometheusConfigured,
  };
});

import { getRuntimeTools } from '../runtime-tools';

function cloneConfig(): Config {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
  config.llm.apiKey = 'test-key';
  return config;
}

function makeTool(name: string): Tool {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({}),
  };
}

const TOOLS: Tool[] = [
  makeTool('kubernetes_query'),
  makeTool('github_query'),
  makeTool('gitlab_query'),
  makeTool('operability_context_query'),
  makeTool('aws_query'),
  makeTool('cloudwatch_alarms'),
  makeTool('cloudwatch_logs'),
  makeTool('pagerduty_get_incident'),
  makeTool('opsgenie_get_incident'),
  makeTool('slack_post_message'),
  makeTool('datadog'),
  makeTool('prometheus'),
  makeTool('search_knowledge'),
];

describe('getRuntimeTools', () => {
  beforeEach(() => {
    delete process.env.DD_API_KEY;
    delete process.env.DD_APP_KEY;

    mocks.loadServiceConfig.mockResolvedValue({
      observability: {
        cloudwatch: { enabled: true },
        datadog: { enabled: false },
      },
    });
    mocks.isPrometheusConfigured.mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('filters tools by disabled providers', async () => {
    const config = cloneConfig();
    config.providers.aws.enabled = false;

    const filtered = await getRuntimeTools(config, TOOLS);
    const names = new Set(filtered.map((tool) => tool.name));

    expect(names.has('kubernetes_query')).toBe(false);
    expect(names.has('github_query')).toBe(false);
    expect(names.has('gitlab_query')).toBe(false);
    expect(names.has('operability_context_query')).toBe(false);
    expect(names.has('aws_query')).toBe(false);
    expect(names.has('cloudwatch_alarms')).toBe(false);
    expect(names.has('cloudwatch_logs')).toBe(false);
    expect(names.has('pagerduty_get_incident')).toBe(false);
    expect(names.has('opsgenie_get_incident')).toBe(false);
    expect(names.has('slack_post_message')).toBe(false);
    expect(names.has('datadog')).toBe(false);
    expect(names.has('prometheus')).toBe(false);
    expect(names.has('search_knowledge')).toBe(true);
  });

  it('retains tools when corresponding providers are enabled and configured', async () => {
    const config = cloneConfig();
    config.providers.kubernetes.enabled = true;
    config.providers.github.enabled = true;
    config.providers.gitlab.enabled = true;
    config.providers.operabilityContext.enabled = true;
    config.providers.aws.enabled = true;
    config.incident.pagerduty.enabled = true;
    config.incident.opsgenie.enabled = true;
    config.incident.slack.enabled = true;

    mocks.loadServiceConfig.mockResolvedValue({
      observability: {
        cloudwatch: { enabled: true },
        datadog: { enabled: true, apiKey: 'dd-api', appKey: 'dd-app' },
      },
    });
    mocks.isPrometheusConfigured.mockReturnValue(true);

    const filtered = await getRuntimeTools(config, TOOLS);
    const names = new Set(filtered.map((tool) => tool.name));

    expect(names.has('kubernetes_query')).toBe(true);
    expect(names.has('github_query')).toBe(true);
    expect(names.has('gitlab_query')).toBe(true);
    expect(names.has('operability_context_query')).toBe(true);
    expect(names.has('aws_query')).toBe(true);
    expect(names.has('cloudwatch_alarms')).toBe(true);
    expect(names.has('cloudwatch_logs')).toBe(true);
    expect(names.has('pagerduty_get_incident')).toBe(true);
    expect(names.has('opsgenie_get_incident')).toBe(true);
    expect(names.has('slack_post_message')).toBe(true);
    expect(names.has('datadog')).toBe(true);
    expect(names.has('prometheus')).toBe(true);
  });

  it('filters cloudwatch tools when cloudwatch is disabled in service config', async () => {
    const config = cloneConfig();
    config.providers.aws.enabled = true;

    mocks.loadServiceConfig.mockResolvedValue({
      observability: {
        cloudwatch: { enabled: false },
        datadog: { enabled: false },
      },
    });

    const filtered = await getRuntimeTools(config, TOOLS);
    const names = new Set(filtered.map((tool) => tool.name));

    expect(names.has('aws_query')).toBe(true);
    expect(names.has('cloudwatch_alarms')).toBe(false);
    expect(names.has('cloudwatch_logs')).toBe(false);
  });

  it('requires configured Datadog keys before exposing the datadog tool', async () => {
    const config = cloneConfig();

    mocks.loadServiceConfig.mockResolvedValue({
      observability: {
        cloudwatch: { enabled: true },
        datadog: { enabled: true },
      },
    });

    let filtered = await getRuntimeTools(config, TOOLS);
    let names = new Set(filtered.map((tool) => tool.name));
    expect(names.has('datadog')).toBe(false);

    process.env.DD_API_KEY = 'env-api';
    process.env.DD_APP_KEY = 'env-app';

    filtered = await getRuntimeTools(config, TOOLS);
    names = new Set(filtered.map((tool) => tool.name));
    expect(names.has('datadog')).toBe(true);
  });

  it('filters prometheus unless runtime connectivity is configured', async () => {
    const config = cloneConfig();

    mocks.isPrometheusConfigured.mockReturnValue(false);
    let filtered = await getRuntimeTools(config, TOOLS);
    let names = new Set(filtered.map((tool) => tool.name));
    expect(names.has('prometheus')).toBe(false);

    mocks.isPrometheusConfigured.mockReturnValue(true);
    filtered = await getRuntimeTools(config, TOOLS);
    names = new Set(filtered.map((tool) => tool.name));
    expect(names.has('prometheus')).toBe(true);
  });
});
