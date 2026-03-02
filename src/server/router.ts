/**
 * HTTP API Router
 *
 * Routes incoming requests to the appropriate handler.
 * Uses raw http.createServer (no framework), following the same
 * pattern as src/webhooks/slack-webhook.ts.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { IKnowledgeRetriever } from '../knowledge/retriever/types';
import type { KnowledgeDocument, KnowledgeType } from '../knowledge/types';
import type { Config } from '../utils/config';
import type { MCPServer } from '../mcp/server';
import { handleMcpRequest } from './mcp-transport';
import { authenticateRequest, readBody, sendJson, serveAdminFile } from './utils';

export interface RouterConfig {
  apiKey: string;
  retriever: IKnowledgeRetriever;
  mcpServer: MCPServer;
  version: string;
  config: Config;
}

export function createRouter(routerConfig: RouterConfig) {
  const { apiKey, retriever, mcpServer, version, config } = routerConfig;
  const startTime = Date.now();

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;
    const method = req.method || 'GET';

    // Health check — no auth required
    if (path === '/api/v1/health' && method === 'GET') {
      sendJson(res, 200, {
        data: {
          status: 'ok',
          version,
          uptime: Math.floor((Date.now() - startTime) / 1000),
        },
      });
      return;
    }

    // MCP endpoint
    if (path === '/mcp') {
      if (!authenticateRequest(req, apiKey)) {
        sendJson(res, 401, {
          error: { code: 'unauthorized', message: 'Invalid or missing API key' },
        });
        return;
      }
      await handleMcpRequest(req, res, mcpServer);
      return;
    }

    // All other API routes require auth
    if (path.startsWith('/api/v1/knowledge/')) {
      if (!authenticateRequest(req, apiKey)) {
        sendJson(res, 401, {
          error: { code: 'unauthorized', message: 'Invalid or missing API key' },
        });
        return;
      }

      const start = Date.now();

      try {
        if (path === '/api/v1/knowledge/search' && method === 'POST') {
          await handleSearch(req, res, retriever, start);
          return;
        }

        if (path === '/api/v1/knowledge/stats' && method === 'GET') {
          await handleStats(res, retriever, start);
          return;
        }

        if (path === '/api/v1/knowledge/documents' && method === 'GET') {
          await handleDocuments(url, res, retriever, start);
          return;
        }

        if (path === '/api/v1/knowledge/services' && method === 'GET') {
          await handleServices(url, res, retriever, start);
          return;
        }

        if (path === '/api/v1/knowledge/sync' && method === 'POST') {
          await handleSync(res, retriever, start);
          return;
        }

        if (path === '/api/v1/knowledge/sources' && method === 'GET') {
          handleSources(res, config, start);
          return;
        }

        // Document CRUD by ID: /api/v1/knowledge/documents/:id
        if (path.startsWith('/api/v1/knowledge/documents/') && path.split('/').length === 6) {
          const id = decodeURIComponent(path.split('/')[5]);
          await handleDocumentById(req, res, retriever, id, method, start);
          return;
        }
      } catch (error) {
        sendJson(res, 500, {
          error: {
            code: 'internal_error',
            message: error instanceof Error ? error.message : String(error),
          },
          meta: { durationMs: Date.now() - start },
        });
        return;
      }
    }

    // Admin UI — serve static files from admin-dist
    if (path === '/admin' || path.startsWith('/admin/')) {
      await serveAdminFile(path, res);
      return;
    }

    // Not found
    sendJson(res, 404, { error: { code: 'not_found', message: `No route for ${method} ${path}` } });
  };
}

async function handleSearch(
  req: IncomingMessage,
  res: ServerResponse,
  retriever: IKnowledgeRetriever,
  start: number
): Promise<void> {
  const body = await readBody(req);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: { code: 'bad_request', message: 'Invalid JSON body' } });
    return;
  }

  const query = String(parsed.query || '');
  if (!query.trim()) {
    sendJson(res, 400, { error: { code: 'bad_request', message: 'query is required' } });
    return;
  }

  const options: {
    typeFilter?: KnowledgeType[];
    serviceFilter?: string[];
    limit?: number;
    rerank?: boolean;
  } = {};

  if (Array.isArray(parsed.typeFilter)) {
    options.typeFilter = parsed.typeFilter.map(String) as KnowledgeType[];
  }
  if (Array.isArray(parsed.serviceFilter)) {
    options.serviceFilter = parsed.serviceFilter.map(String);
  }
  if (typeof parsed.limit === 'number') {
    options.limit = parsed.limit;
  }
  if (typeof parsed.rerank === 'boolean') {
    options.rerank = parsed.rerank;
  }

  const results = await retriever.search(query, options);
  sendJson(res, 200, { data: results, meta: { durationMs: Date.now() - start } });
}

async function handleStats(
  res: ServerResponse,
  retriever: IKnowledgeRetriever,
  start: number
): Promise<void> {
  const counts = await retriever.getDocumentCountsByType();
  sendJson(res, 200, { data: counts, meta: { durationMs: Date.now() - start } });
}

async function handleDocuments(
  url: URL,
  res: ServerResponse,
  retriever: IKnowledgeRetriever,
  start: number
): Promise<void> {
  let docs = await retriever.getAllDocuments();
  const typeFilter = url.searchParams.get('type');
  if (typeFilter) {
    docs = docs.filter((d) => d.type === typeFilter);
  }
  sendJson(res, 200, { data: docs, meta: { durationMs: Date.now() - start } });
}

async function handleServices(
  url: URL,
  res: ServerResponse,
  retriever: IKnowledgeRetriever,
  start: number
): Promise<void> {
  const allDocs = await retriever.getAllDocuments();
  const typeFilter = url.searchParams.get('type') as KnowledgeType | null;
  const services = new Set<string>();

  for (const doc of allDocs) {
    if (typeFilter && doc.type !== typeFilter) continue;
    for (const service of doc.services) {
      services.add(service);
    }
  }

  sendJson(res, 200, {
    data: Array.from(services).sort(),
    meta: { durationMs: Date.now() - start },
  });
}

async function handleSync(
  res: ServerResponse,
  retriever: IKnowledgeRetriever,
  start: number
): Promise<void> {
  const result = await retriever.sync();
  sendJson(res, 200, { data: result, meta: { durationMs: Date.now() - start } });
}

async function handleDocumentById(
  req: IncomingMessage,
  res: ServerResponse,
  retriever: IKnowledgeRetriever,
  id: string,
  method: string,
  start: number
): Promise<void> {
  if (method === 'GET') {
    if (!retriever.getDocument) {
      sendJson(res, 501, {
        error: { code: 'not_implemented', message: 'getDocument not supported' },
      });
      return;
    }
    const doc = await retriever.getDocument(id);
    if (!doc) {
      sendJson(res, 404, { error: { code: 'not_found', message: `Document ${id} not found` } });
      return;
    }
    sendJson(res, 200, { data: doc, meta: { durationMs: Date.now() - start } });
    return;
  }

  if (method === 'PUT') {
    if (!retriever.getDocument || !retriever.upsertDocument) {
      sendJson(res, 501, {
        error: { code: 'not_implemented', message: 'upsertDocument not supported' },
      });
      return;
    }
    const body = await readBody(req);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body);
    } catch {
      sendJson(res, 400, { error: { code: 'bad_request', message: 'Invalid JSON body' } });
      return;
    }

    const existing = await retriever.getDocument(id);
    if (!existing) {
      sendJson(res, 404, { error: { code: 'not_found', message: `Document ${id} not found` } });
      return;
    }

    const updated: KnowledgeDocument = {
      ...existing,
      title: typeof parsed.title === 'string' ? parsed.title : existing.title,
      content: typeof parsed.content === 'string' ? parsed.content : existing.content,
      type: typeof parsed.type === 'string' ? (parsed.type as KnowledgeType) : existing.type,
      services: Array.isArray(parsed.services) ? parsed.services.map(String) : existing.services,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : existing.tags,
      updatedAt: new Date().toISOString(),
    };

    await retriever.upsertDocument(updated);
    sendJson(res, 200, { data: updated, meta: { durationMs: Date.now() - start } });
    return;
  }

  if (method === 'DELETE') {
    if (!retriever.deleteDocument) {
      sendJson(res, 501, {
        error: { code: 'not_implemented', message: 'deleteDocument not supported' },
      });
      return;
    }
    await retriever.deleteDocument(id);
    sendJson(res, 200, { data: { deleted: true }, meta: { durationMs: Date.now() - start } });
    return;
  }

  sendJson(res, 405, { error: { code: 'method_not_allowed', message: `${method} not allowed` } });
}

function handleSources(res: ServerResponse, config: Config, start: number): void {
  const sources = (config.knowledge?.sources || []).map((s) => ({
    type: s.type,
    path: s.path,
    repo: s.repo,
    branch: s.branch,
    baseUrl: s.baseUrl,
    spaceKey: s.spaceKey,
    endpoint: s.endpoint,
    databaseId: s.databaseId,
    authConfigured: !!s.auth,
  }));
  sendJson(res, 200, { data: sources, meta: { durationMs: Date.now() - start } });
}
