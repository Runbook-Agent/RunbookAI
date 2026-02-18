import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFromApi } from '../api';
import type { ApiSourceConfig } from '../../types';

function asFetchResponse(
  body: unknown,
  options: { ok?: boolean; status?: number; contentType?: string } = {}
): Response {
  const ok = options.ok ?? true;
  const status = options.status ?? 200;
  const contentType = options.contentType ?? 'application/json';

  const textBody = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    } as Headers,
    text: async () => textBody,
  } as Response;
}

describe('API knowledge source', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads JSON documents and applies auth headers', async () => {
    const config: ApiSourceConfig = {
      type: 'api',
      endpoint: 'https://knowledge.internal/documents',
      auth: {
        type: 'bearer',
        value: 'token_abc',
      },
    };

    const fetchMock = vi.fn().mockResolvedValue(
      asFetchResponse({
        documents: [
          {
            id: 'checkout-runbook',
            title: 'Checkout Incident Runbook',
            content: '# Mitigation\nRestart workers and clear stale cache.',
            type: 'runbook',
            services: ['checkout'],
            tags: ['incident'],
            severity: 'sev1',
            updatedAt: '2026-02-10T00:00:00.000Z',
            url: 'https://knowledge.internal/docs/checkout',
          },
        ],
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    const docs = await loadFromApi(config, { since: '2026-02-01T00:00:00.000Z' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('since=2026-02-01T00%3A00%3A00.000Z');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token_abc');

    expect(docs.length).toBe(1);
    expect(docs[0].id).toBe('api_checkout-runbook');
    expect(docs[0].title).toBe('Checkout Incident Runbook');
    expect(docs[0].type).toBe('runbook');
    expect(docs[0].services).toEqual(['checkout']);
    expect(docs[0].severityRelevance).toEqual(['sev1']);
    expect(docs[0].sourceUrl).toBe('https://knowledge.internal/docs/checkout');
    expect(docs[0].chunks.length).toBeGreaterThan(0);
  });

  it('filters out stale documents using the since option', async () => {
    const config: ApiSourceConfig = {
      type: 'api',
      endpoint: 'https://knowledge.internal/items',
    };

    const fetchMock = vi.fn().mockResolvedValue(
      asFetchResponse([
        {
          id: 'old',
          title: 'Old Runbook',
          content: 'Old content',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'new',
          title: 'New Runbook',
          content: 'Fresh content',
          updatedAt: '2026-02-03T00:00:00.000Z',
        },
      ])
    );

    vi.stubGlobal('fetch', fetchMock);

    const docs = await loadFromApi(config, {
      since: '2026-02-01T00:00:00.000Z',
    });

    expect(docs.map((doc) => doc.id)).toEqual(['api_new']);
  });

  it('supports plain text payloads and custom header auth', async () => {
    const config: ApiSourceConfig = {
      type: 'api',
      endpoint: 'https://knowledge.internal/plaintext',
      auth: {
        type: 'header',
        value: 'X-Runbook-Key: abc123',
      },
    };

    const fetchMock = vi.fn().mockResolvedValue(
      asFetchResponse('# Recovery Guide\nRe-deploy checkout service.', {
        contentType: 'text/plain',
      })
    );

    vi.stubGlobal('fetch', fetchMock);

    const docs = await loadFromApi(config);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-Runbook-Key']).toBe('abc123');

    expect(docs.length).toBe(1);
    expect(docs[0].title).toBe('Recovery Guide');
    expect(docs[0].type).toBe('runbook');
    expect(docs[0].content).toContain('Re-deploy checkout service.');
  });
});
