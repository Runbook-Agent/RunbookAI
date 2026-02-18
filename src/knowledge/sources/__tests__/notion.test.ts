import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFromNotion } from '../notion';
import type { NotionSourceConfig } from '../../types';

function asFetchResponse(body: unknown, ok: boolean = true, status: number = 200): Response {
  return {
    ok,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  } as Response;
}

const notionConfig: NotionSourceConfig = {
  type: 'notion',
  databaseId: 'db_123',
  apiKey: 'secret_notion_key',
};

describe('Notion knowledge source', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads database pages and converts blocks to markdown documents', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/databases/db_123/query')) {
        return asFetchResponse({
          results: [
            {
              id: 'page_1',
              url: 'https://www.notion.so/page_1',
              created_time: '2026-01-01T00:00:00.000Z',
              last_edited_time: '2026-01-02T00:00:00.000Z',
              properties: {
                Name: {
                  type: 'title',
                  title: [{ plain_text: 'Checkout API Runbook' }],
                },
                Type: {
                  type: 'select',
                  select: { name: 'runbook' },
                },
                Services: {
                  type: 'multi_select',
                  multi_select: [{ name: 'checkout' }, { name: 'payments' }],
                },
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        });
      }

      if (url.includes('/blocks/page_1/children')) {
        return asFetchResponse({
          results: [
            {
              id: 'blk_1',
              type: 'heading_1',
              heading_1: {
                rich_text: [{ plain_text: 'Mitigation Steps' }],
              },
              has_children: false,
            },
            {
              id: 'blk_2',
              type: 'paragraph',
              paragraph: {
                rich_text: [{ plain_text: 'Restart workers and flush stale connections.' }],
              },
              has_children: false,
            },
          ],
          has_more: false,
          next_cursor: null,
        });
      }

      return asFetchResponse('not found', false, 404);
    });

    vi.stubGlobal('fetch', fetchMock);

    const documents = await loadFromNotion(notionConfig);
    expect(documents.length).toBe(1);
    expect(documents[0].title).toBe('Checkout API Runbook');
    expect(documents[0].services).toEqual(['checkout', 'payments']);
    expect(documents[0].type).toBe('runbook');
    expect(documents[0].content).toContain('# Mitigation Steps');
    expect(documents[0].content).toContain('Restart workers');
    expect(documents[0].chunks.length).toBeGreaterThan(0);
  });

  it('respects the since option and skips older pages', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/databases/db_123/query')) {
        return asFetchResponse({
          results: [
            {
              id: 'old_page',
              url: 'https://www.notion.so/old_page',
              created_time: '2026-01-01T00:00:00.000Z',
              last_edited_time: '2026-01-01T00:00:00.000Z',
              properties: {
                Name: {
                  type: 'title',
                  title: [{ plain_text: 'Old Runbook' }],
                },
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        });
      }
      return asFetchResponse({
        results: [],
        has_more: false,
        next_cursor: null,
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const documents = await loadFromNotion(notionConfig, {
      since: '2026-01-02T00:00:00.000Z',
    });
    expect(documents).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses fallback title when title property is missing', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/databases/db_123/query')) {
        return asFetchResponse({
          results: [
            {
              id: 'page_no_title',
              url: 'https://www.notion.so/page_no_title',
              created_time: '2026-01-01T00:00:00.000Z',
              last_edited_time: '2026-01-03T00:00:00.000Z',
              properties: {},
            },
          ],
          has_more: false,
          next_cursor: null,
        });
      }
      if (url.includes('/blocks/page_no_title/children')) {
        return asFetchResponse({
          results: [
            {
              id: 'blk_x',
              type: 'paragraph',
              paragraph: {
                rich_text: [{ plain_text: 'General recovery guidance.' }],
              },
              has_children: false,
            },
          ],
          has_more: false,
          next_cursor: null,
        });
      }
      return asFetchResponse('not found', false, 404);
    });

    vi.stubGlobal('fetch', fetchMock);

    const documents = await loadFromNotion(notionConfig);
    expect(documents.length).toBe(1);
    expect(documents[0].title).toBe('Untitled');
    expect(documents[0].type).toBe('runbook');
  });
});
