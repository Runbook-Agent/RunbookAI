/**
 * RunbookAI Shared Knowledge Server
 *
 * Starts an HTTP server exposing the knowledge API and MCP endpoint.
 * Usage: runbook server --port 4000 --api-key <key>
 */

import { createServer } from 'http';
import type { Config } from '../utils/config';
import { createConfiguredRetriever } from '../knowledge/retriever/index';
import { MCPServer } from '../mcp/server';
import { createRouter } from './router';

export interface ServerOptions {
  port: number;
  host: string;
  baseDir: string;
  apiKey: string;
  config?: Config;
}

export async function startServer(options: ServerOptions): Promise<void> {
  const { port, host, baseDir, apiKey, config } = options;

  // Create the local retriever (server always uses local storage)
  const retriever = await createConfiguredRetriever(baseDir, config);

  // Create MCP server and inject the retriever
  const mcpServer = new MCPServer({ baseDir });
  mcpServer.setRetriever(retriever);

  // Read version from package.json (best-effort)
  let version = '0.0.0';
  try {
    const pkg = await import('../../package.json', { with: { type: 'json' } });
    version = pkg.default.version || version;
  } catch {
    // Fallback is fine
  }

  const router = createRouter({ apiKey, retriever, mcpServer, version });
  const server = createServer(router);

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down...');
    retriever.close();
    mcpServer.close();
    server.close(() => process.exit(0));
    // Force exit after 5s
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      console.log(`RunbookAI server listening on http://${host}:${port}`);
      console.log(`  Health:  http://${host}:${port}/api/v1/health`);
      console.log(`  API:     http://${host}:${port}/api/v1/knowledge/...`);
      console.log(`  MCP:     http://${host}:${port}/mcp`);
      resolve();
    });
  });
}
