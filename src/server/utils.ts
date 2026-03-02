/**
 * Server Utilities
 *
 * Shared helpers for the RunbookAI HTTP server.
 */

import { timingSafeEqual } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';

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
