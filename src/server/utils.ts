/**
 * Server Utilities
 *
 * Shared helpers for the RunbookAI HTTP server.
 */

import { timingSafeEqual } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import { dirname, extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

export interface ApiEnvelope<T = unknown> {
  data?: T;
  error?: { code: string; message: string };
  meta?: { durationMs: number };
}

export function sendJson<T>(res: ServerResponse, status: number, body: ApiEnvelope<T>): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function authenticateRequest(req: IncomingMessage, expectedKey: string): boolean {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.slice(7);
  if (token.length !== expectedKey.length) {
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expectedKey));
  } catch {
    return false;
  }
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export async function serveAdminFile(path: string, res: ServerResponse): Promise<void> {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  // admin-dist is a sibling of this file (src/server/admin-dist/ or dist/admin-dist/)
  // When running via tsx: currentDir = src/server/
  // When running compiled: currentDir = dist/ — we look relative to the source tree
  const adminDir = existsSync(resolve(currentDir, 'admin-dist'))
    ? resolve(currentDir, 'admin-dist')
    : resolve(currentDir, '..', 'src', 'server', 'admin-dist');

  // Strip /admin prefix
  let filePath = path.replace(/^\/admin\/?/, '') || 'index.html';

  // SPA routing: paths without file extensions serve index.html
  const ext = extname(filePath);
  if (!ext) {
    filePath = 'index.html';
  }

  const fullPath = join(adminDir, filePath);

  if (!existsSync(fullPath)) {
    // For SPA routes, fall back to index.html
    const indexPath = join(adminDir, 'index.html');
    if (existsSync(indexPath)) {
      const content = readFileSync(indexPath);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': content.length,
        'Cache-Control': 'no-cache',
      });
      res.end(content);
      return;
    }
    sendJson(res, 404, {
      error: { code: 'not_found', message: 'Admin UI not built. Run: npm run build:admin' },
    });
    return;
  }

  const content = readFileSync(fullPath);
  const mimeType = MIME_TYPES[extname(fullPath)] || 'application/octet-stream';
  const isHtml = extname(fullPath) === '.html';

  res.writeHead(200, {
    'Content-Type': mimeType,
    'Content-Length': content.length,
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  res.end(content);
}
