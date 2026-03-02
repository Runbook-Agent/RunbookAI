/**
 * MCP Streamable HTTP Transport
 *
 * Handles POST /mcp with JSON-RPC body, dispatching to MCPServer.
 * Supports both JSON and SSE response modes.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { MCPServer } from '../mcp/server';
import { readBody, sendJson } from './utils';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  mcpServer: MCPServer
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'POST required' } });
    return;
  }

  let body: string;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 400, { error: { code: 'bad_request', message: 'Failed to read request body' } });
    return;
  }

  let rpcRequest: JsonRpcRequest;
  try {
    rpcRequest = JSON.parse(body);
  } catch {
    const rpcError: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rpcError));
    return;
  }

  const rpcResponse = await dispatchRpc(rpcRequest, mcpServer);

  const accept = req.headers['accept'] || '';
  if (accept.includes('text/event-stream')) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(rpcResponse)}\n\n`);
    res.end();
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rpcResponse));
  }
}

async function dispatchRpc(
  request: JsonRpcRequest,
  mcpServer: MCPServer
): Promise<JsonRpcResponse> {
  try {
    switch (request.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'runbook-ai', version: '1.0.0' },
            capabilities: { tools: {} },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: mcpServer.handleListTools(),
        };

      case 'tools/call': {
        const params = request.params || {};
        const result = await mcpServer.handleToolCall({
          name: String(params.name || ''),
          arguments: (params.arguments as Record<string, unknown>) || {},
        });
        return {
          jsonrpc: '2.0',
          id: request.id,
          result,
        };
      }

      default:
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32601, message: `Method not found: ${request.method}` },
        };
    }
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32603,
        message: `Internal error: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}
