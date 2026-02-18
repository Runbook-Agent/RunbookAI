import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFromGitHub } from '../github';
import type { GitHubSourceConfig } from '../../types';

function asFetchResponse(body: unknown, ok: boolean = true, status: number = 200): Response {
  return {
    ok,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  } as Response;
}

describe('GitHub knowledge source', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads markdown knowledge documents from git tree + blob APIs', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/git/trees/')) {
        return asFetchResponse({
          sha: 'tree-sha',
          truncated: false,
          tree: [
            {
              path: 'runbooks/checkout-timeout.md',
              mode: '100644',
              type: 'blob',
              sha: 'blob-sha-1',
            },
            {
              path: 'README.md',
              mode: '100644',
              type: 'blob',
              sha: 'blob-sha-2',
            },
          ],
        });
      }

      if (url.includes('/git/blobs/blob-sha-1')) {
        const markdown = `---
type: runbook
services: [checkout]
tags: [incident]
---
# Checkout Timeout Recovery

Restart workers and verify queue depth.
`;
        return asFetchResponse({
          encoding: 'base64',
          content: Buffer.from(markdown, 'utf-8').toString('base64'),
        });
      }

      if (url.includes('/git/blobs/blob-sha-2')) {
        const markdown = '# Repo README';
        return asFetchResponse({
          encoding: 'base64',
          content: Buffer.from(markdown, 'utf-8').toString('base64'),
        });
      }

      return asFetchResponse('not found', false, 404);
    });

    vi.stubGlobal('fetch', fetchMock);

    const config: GitHubSourceConfig = {
      type: 'github',
      repo: 'acme/platform',
      branch: 'main',
      path: 'runbooks',
    };

    const docs = await loadFromGitHub(config);
    expect(docs.length).toBe(1);
    expect(docs[0].type).toBe('runbook');
    expect(docs[0].title).toBe('Checkout Timeout Recovery');
    expect(docs[0].services).toEqual(['checkout']);
    expect(docs[0].sourceUrl).toContain('/acme/platform/blob/main/runbooks/checkout-timeout.md');
  });

  it('accepts repository URLs in addition to owner/repo format', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      asFetchResponse({
        sha: 'tree-sha',
        truncated: false,
        tree: [],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const config: GitHubSourceConfig = {
      type: 'github',
      repo: 'https://github.com/acme/platform.git',
      branch: 'main',
      path: '',
    };

    await loadFromGitHub(config);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('/repos/acme/platform/git/trees/main');
  });

  it('throws a helpful error for invalid repository format', async () => {
    const config: GitHubSourceConfig = {
      type: 'github',
      repo: 'acme/platform/extra',
      branch: 'main',
      path: '',
    };

    await expect(loadFromGitHub(config)).rejects.toThrow('Invalid GitHub repo format');
  });
});
