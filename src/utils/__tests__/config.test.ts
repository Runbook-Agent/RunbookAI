import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, validateConfig, type Config } from '../config';

function cloneConfig(): Config {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Config;
  config.llm.apiKey = 'test-key';
  return config;
}

afterEach(() => {
  delete process.env.RUNBOOK_NOTION_API_KEY;
  delete process.env.NOTION_API_KEY;
  delete process.env.RUNBOOK_GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
});

describe('validateConfig knowledge source checks', () => {
  it('accepts valid notion/github/api source credentials', () => {
    const config = cloneConfig();
    config.knowledge.sources = [
      {
        type: 'notion',
        databaseId: 'db_123',
        apiKey: 'secret_notion',
      },
      {
        type: 'github',
        repo: 'acme/runbooks',
        token: 'ghp_token',
        branch: 'main',
        path: 'docs/runbooks',
      },
      {
        type: 'api',
        endpoint: 'https://knowledge.internal/documents',
        auth: {
          type: 'bearer',
          value: 'api_token',
        },
      },
    ];

    const errors = validateConfig(config);
    expect(errors.filter((error) => error.startsWith('Knowledge source'))).toEqual([]);
  });

  it('supports environment variable fallback for notion/github tokens', () => {
    process.env.RUNBOOK_NOTION_API_KEY = 'notion_env_token';
    process.env.GITHUB_TOKEN = 'github_env_token';

    const config = cloneConfig();
    config.knowledge.sources = [
      {
        type: 'notion',
        databaseId: 'db_abc',
      },
      {
        type: 'github',
        repo: 'acme/platform',
      },
    ];

    const errors = validateConfig(config);
    expect(errors.filter((error) => error.startsWith('Knowledge source'))).toEqual([]);
  });

  it('returns clear errors for incomplete knowledge sources', () => {
    const config = cloneConfig();
    config.knowledge.sources = [
      { type: 'filesystem' },
      { type: 'confluence', baseUrl: 'https://example.atlassian.net' },
      {
        type: 'google_drive',
        folderIds: ['folder_1'],
        clientId: 'client_id',
        clientSecret: 'client_secret',
      },
      { type: 'notion' },
      { type: 'github' },
      { type: 'api' },
    ];

    const errors = validateConfig(config);

    expect(errors.some((error) => error.includes('filesystem'))).toBe(true);
    expect(errors.some((error) => error.includes('confluence'))).toBe(true);
    expect(errors.some((error) => error.includes('google_drive'))).toBe(true);
    expect(errors.some((error) => error.includes('notion'))).toBe(true);
    expect(errors.some((error) => error.includes('github'))).toBe(true);
    expect(errors.some((error) => error.includes('api'))).toBe(true);
  });
});
