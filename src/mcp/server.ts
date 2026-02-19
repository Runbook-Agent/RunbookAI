/**
 * MCP Server for RunbookAI Knowledge Access
 *
 * Exposes RunbookAI's knowledge base and investigation capabilities
 * to Claude Code via the Model Context Protocol.
 */

import { createConfiguredRetriever, KnowledgeRetriever } from '../knowledge/retriever/index';
import type { RetrievedChunk, KnowledgeType } from '../knowledge/types';

/**
 * MCP Tool definition
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, MCPPropertySchema>;
    required?: string[];
  };
}

export interface MCPPropertySchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  items?: MCPPropertySchema;
  enum?: string[];
  default?: unknown;
}

/**
 * MCP Tool call request
 */
export interface MCPToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * MCP Tool call response
 */
export interface MCPToolCallResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

/**
 * MCP Resource definition
 */
export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

/**
 * MCP Resource read response
 */
export interface MCPResourceReadResponse {
  contents: Array<{
    uri: string;
    mimeType: string;
    text: string;
  }>;
}

/**
 * Available MCP tools
 */
export const MCP_TOOLS: MCPTool[] = [
  {
    name: 'search_runbooks',
    description:
      'Search organizational runbooks for troubleshooting procedures and operational guides. Returns relevant runbooks with content previews.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "database connection timeout", "high latency")',
        },
        services: {
          type: 'array',
          description: 'Filter by service names',
          items: { type: 'string', description: 'Service name' },
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 5)',
          default: 5,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_known_issues',
    description:
      'Get active known issues that may explain current symptoms. Known issues include workarounds and related tickets.',
    inputSchema: {
      type: 'object',
      properties: {
        services: {
          type: 'array',
          description: 'Services to check for known issues',
          items: { type: 'string', description: 'Service name' },
        },
        symptoms: {
          type: 'array',
          description: 'Symptoms to match against known issues',
          items: { type: 'string', description: 'Symptom description' },
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 5)',
          default: 5,
        },
      },
    },
  },
  {
    name: 'search_postmortems',
    description:
      'Search past incident postmortems for similar issues. Useful for understanding historical context and proven solutions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for postmortems',
        },
        services: {
          type: 'array',
          description: 'Filter by affected services',
          items: { type: 'string', description: 'Service name' },
        },
        rootCause: {
          type: 'string',
          description: 'Search by root cause type (e.g., "configuration", "capacity")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 3)',
          default: 3,
        },
      },
    },
  },
  {
    name: 'get_knowledge_stats',
    description: 'Get statistics about available knowledge in the RunbookAI knowledge base.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_services',
    description: 'List all services that have associated runbooks or documentation.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Filter by knowledge type',
          enum: ['runbook', 'postmortem', 'architecture', 'known_issue'],
        },
      },
    },
  },
  {
    name: 'query_changes',
    description:
      'Query recent change events (deployments, config changes, migrations) from the Change Intelligence Service. Returns a list of changes with metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        services: {
          type: 'array',
          description: 'Filter by service names',
          items: { type: 'string', description: 'Service name' },
        },
        since_minutes: {
          type: 'number',
          description: 'Only show changes from the last N minutes (default: 60)',
          default: 60,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 10)',
          default: 10,
        },
      },
    },
  },
  {
    name: 'predict_change_impact',
    description:
      'Predict the blast radius and risk level of a change using the service dependency graph. Shows directly and transitively affected services.',
    inputSchema: {
      type: 'object',
      properties: {
        services: {
          type: 'array',
          description: 'Services being changed',
          items: { type: 'string', description: 'Service name' },
        },
        change_type: {
          type: 'string',
          description: 'Type of change (deployment, config_change, db_migration, etc.)',
        },
      },
      required: ['services'],
    },
  },
];

/**
 * MCP Server configuration
 */
export interface MCPServerConfig {
  baseDir: string;
}

const DEFAULT_CONFIG: MCPServerConfig = {
  baseDir: '.runbook',
};

/**
 * Format retrieved chunks as text output
 */
function formatChunks(chunks: RetrievedChunk[], type: string): string {
  if (chunks.length === 0) {
    return `No ${type} found matching your query.`;
  }

  const lines: string[] = [`## ${type} (${chunks.length} results)\n`];

  for (const chunk of chunks) {
    const score = Math.round(chunk.score * 100);
    lines.push(`### ${chunk.title}`);
    lines.push(`- **Relevance:** ${score}%`);
    lines.push(`- **Services:** ${chunk.services.join(', ') || 'general'}`);
    if (chunk.sourceUrl) {
      lines.push(`- **Source:** ${chunk.sourceUrl}`);
    }
    lines.push('');
    // Limit content to 1000 chars per chunk
    const content = chunk.content.slice(0, 1000);
    lines.push(content);
    if (chunk.content.length > 1000) {
      lines.push('\n_[Content truncated]_');
    }
    lines.push('\n---\n');
  }

  return lines.join('\n');
}

/**
 * Handle search_runbooks tool call
 */
async function handleSearchRunbooks(
  args: Record<string, unknown>,
  retriever: KnowledgeRetriever
): Promise<MCPToolCallResponse> {
  const query = String(args.query || '');
  const services = Array.isArray(args.services) ? args.services.map(String) : undefined;
  const limit = typeof args.limit === 'number' ? args.limit : 5;

  const knowledge = await retriever.search(query, {
    typeFilter: ['runbook'],
    serviceFilter: services,
    limit,
  });

  return {
    content: [
      {
        type: 'text',
        text: formatChunks(knowledge.runbooks, 'Runbooks'),
      },
    ],
  };
}

/**
 * Handle get_known_issues tool call
 */
async function handleGetKnownIssues(
  args: Record<string, unknown>,
  retriever: KnowledgeRetriever
): Promise<MCPToolCallResponse> {
  const services = Array.isArray(args.services) ? args.services.map(String) : [];
  const symptoms = Array.isArray(args.symptoms) ? args.symptoms.map(String) : [];
  const limit = typeof args.limit === 'number' ? args.limit : 5;

  const query = [...services, ...symptoms].join(' ') || '*';

  const knowledge = await retriever.search(query, {
    typeFilter: ['known_issue'],
    serviceFilter: services.length > 0 ? services : undefined,
    limit,
  });

  return {
    content: [
      {
        type: 'text',
        text: formatChunks(knowledge.knownIssues, 'Known Issues'),
      },
    ],
  };
}

/**
 * Handle search_postmortems tool call
 */
async function handleSearchPostmortems(
  args: Record<string, unknown>,
  retriever: KnowledgeRetriever
): Promise<MCPToolCallResponse> {
  const query = String(args.query || args.rootCause || '*');
  const services = Array.isArray(args.services) ? args.services.map(String) : undefined;
  const limit = typeof args.limit === 'number' ? args.limit : 3;

  const knowledge = await retriever.search(query, {
    typeFilter: ['postmortem'],
    serviceFilter: services,
    limit,
  });

  return {
    content: [
      {
        type: 'text',
        text: formatChunks(knowledge.postmortems, 'Postmortems'),
      },
    ],
  };
}

/**
 * Handle get_knowledge_stats tool call
 */
async function handleGetKnowledgeStats(
  retriever: KnowledgeRetriever
): Promise<MCPToolCallResponse> {
  const counts = retriever.getDocumentCountsByType();
  const total = Object.values(counts).reduce((sum, c) => sum + c, 0);

  const lines: string[] = [
    '## RunbookAI Knowledge Base Statistics\n',
    `**Total Documents:** ${total}\n`,
    '### By Type:',
    `- Runbooks: ${counts.runbook || 0}`,
    `- Postmortems: ${counts.postmortem || 0}`,
    `- Known Issues: ${counts.known_issue || 0}`,
    `- Architecture Docs: ${counts.architecture || 0}`,
    `- FAQs: ${counts.faq || 0}`,
    `- Playbooks: ${counts.playbook || 0}`,
  ];

  return {
    content: [
      {
        type: 'text',
        text: lines.join('\n'),
      },
    ],
  };
}

/**
 * Handle list_services tool call
 */
async function handleListServices(
  args: Record<string, unknown>,
  retriever: KnowledgeRetriever
): Promise<MCPToolCallResponse> {
  const typeFilter = typeof args.type === 'string' ? [args.type as KnowledgeType] : undefined;

  const allDocs = retriever.getAllDocuments();
  const services = new Set<string>();

  for (const doc of allDocs) {
    if (typeFilter && !typeFilter.includes(doc.type)) {
      continue;
    }
    for (const service of doc.services) {
      services.add(service);
    }
  }

  const sortedServices = Array.from(services).sort();

  if (sortedServices.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No services found in the knowledge base.',
        },
      ],
    };
  }

  const lines: string[] = [
    `## Services with Documentation (${sortedServices.length})\n`,
    ...sortedServices.map((s) => `- ${s}`),
  ];

  return {
    content: [
      {
        type: 'text',
        text: lines.join('\n'),
      },
    ],
  };
}

/**
 * Handle query_changes tool call — delegates to Change Intelligence Service
 */
async function handleQueryChanges(args: Record<string, unknown>): Promise<MCPToolCallResponse> {
  const { createChangeIntelligenceAdapter } =
    await import('../providers/change-intelligence/adapter');
  const { loadConfig } = await import('../utils/config');

  try {
    const config = await loadConfig();
    const adapter = createChangeIntelligenceAdapter(config.providers.changeIntelligence);
    if (!adapter) {
      return {
        content: [
          {
            type: 'text',
            text: 'Change Intelligence Service is not configured. Enable it in .runbook/config.yaml under providers.changeIntelligence.',
          },
        ],
      };
    }

    const sinceMinutes = typeof args.since_minutes === 'number' ? args.since_minutes : 60;
    const since = new Date(Date.now() - sinceMinutes * 60_000).toISOString();
    const services = Array.isArray(args.services) ? args.services.map(String) : undefined;
    const limit = typeof args.limit === 'number' ? args.limit : 10;

    const events = await adapter.queryEvents({ services, since, limit });

    if (events.length === 0) {
      return { content: [{ type: 'text', text: 'No recent changes found.' }] };
    }

    const lines = [`## Recent Changes (${events.length})\n`];
    for (const event of events) {
      lines.push(`### ${event.summary}`);
      lines.push(`- **Service:** ${event.service}`);
      lines.push(`- **Type:** ${event.changeType}`);
      lines.push(`- **Status:** ${event.status}`);
      lines.push(`- **Time:** ${event.timestamp}`);
      if (event.commitSha) lines.push(`- **Commit:** ${event.commitSha.slice(0, 8)}`);
      lines.push('');
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error querying changes: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Handle predict_change_impact tool call — delegates to Change Intelligence Service
 */
async function handlePredictChangeImpact(
  args: Record<string, unknown>
): Promise<MCPToolCallResponse> {
  const { createChangeIntelligenceAdapter } =
    await import('../providers/change-intelligence/adapter');
  const { loadConfig } = await import('../utils/config');

  try {
    const config = await loadConfig();
    const adapter = createChangeIntelligenceAdapter(config.providers.changeIntelligence);
    if (!adapter) {
      return {
        content: [
          {
            type: 'text',
            text: 'Change Intelligence Service is not configured. Enable it in .runbook/config.yaml under providers.changeIntelligence.',
          },
        ],
      };
    }

    const services = Array.isArray(args.services) ? args.services.map(String) : [];
    const changeType = typeof args.change_type === 'string' ? args.change_type : undefined;

    const prediction = await adapter.predictBlastRadius(services, changeType);

    const lines = ['## Blast Radius Prediction\n'];
    lines.push(`**Risk Level:** ${prediction.riskLevel}`);
    lines.push(`**Critical Path Affected:** ${prediction.criticalPathAffected ? 'Yes' : 'No'}`);
    if (prediction.directServices.length > 0) {
      lines.push(`\n### Direct Dependencies (${prediction.directServices.length})`);
      for (const svc of prediction.directServices) lines.push(`- ${svc}`);
    }
    if (prediction.downstreamServices.length > 0) {
      lines.push(`\n### Downstream Services (${prediction.downstreamServices.length})`);
      for (const svc of prediction.downstreamServices) lines.push(`- ${svc}`);
    }
    if (prediction.rationale.length > 0) {
      lines.push('\n### Rationale');
      for (const r of prediction.rationale) lines.push(`- ${r}`);
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error predicting impact: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * MCP Server class
 */
export class MCPServer {
  private config: MCPServerConfig;
  private retriever: KnowledgeRetriever | null = null;
  private retrieverPromise: Promise<KnowledgeRetriever> | null = null;

  constructor(config: Partial<MCPServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get available tools
   */
  getTools(): MCPTool[] {
    return MCP_TOOLS;
  }

  /**
   * Initialize the retriever
   */
  private async getRetriever(): Promise<KnowledgeRetriever> {
    if (!this.retriever) {
      if (!this.retrieverPromise) {
        this.retrieverPromise = createConfiguredRetriever(this.config.baseDir);
      }
      this.retriever = await this.retrieverPromise;
    }
    return this.retriever;
  }

  /**
   * Handle a tool call
   */
  async handleToolCall(request: MCPToolCallRequest): Promise<MCPToolCallResponse> {
    const retriever = await this.getRetriever();

    try {
      switch (request.name) {
        case 'search_runbooks':
          return await handleSearchRunbooks(request.arguments, retriever);
        case 'get_known_issues':
          return await handleGetKnownIssues(request.arguments, retriever);
        case 'search_postmortems':
          return await handleSearchPostmortems(request.arguments, retriever);
        case 'get_knowledge_stats':
          return await handleGetKnowledgeStats(retriever);
        case 'list_services':
          return await handleListServices(request.arguments, retriever);
        case 'query_changes':
          return await handleQueryChanges(request.arguments);
        case 'predict_change_impact':
          return await handlePredictChangeImpact(request.arguments);
        default:
          return {
            content: [
              {
                type: 'text',
                text: `Unknown tool: ${request.name}`,
              },
            ],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing tool: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Handle tools/list request
   */
  handleListTools(): { tools: MCPTool[] } {
    return { tools: this.getTools() };
  }

  /**
   * Close the server and clean up resources
   */
  close(): void {
    this.retriever?.close();
    this.retriever = null;
  }
}

/**
 * Create an MCP server instance
 */
export function createMCPServer(config?: Partial<MCPServerConfig>): MCPServer {
  return new MCPServer(config);
}

/**
 * Run the MCP server in stdio mode
 * This reads JSON-RPC messages from stdin and writes responses to stdout
 */
export async function runStdioServer(config?: Partial<MCPServerConfig>): Promise<void> {
  const server = createMCPServer(config);

  // Read JSON-RPC messages from stdin
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  // Handle JSON-RPC messages
  rl.on('line', async (line) => {
    try {
      const message = JSON.parse(line);
      let response: unknown;

      if (message.method === 'tools/list') {
        response = {
          jsonrpc: '2.0',
          id: message.id,
          result: server.handleListTools(),
        };
      } else if (message.method === 'tools/call') {
        const result = await server.handleToolCall({
          name: message.params.name,
          arguments: message.params.arguments || {},
        });
        response = {
          jsonrpc: '2.0',
          id: message.id,
          result,
        };
      } else if (message.method === 'initialize') {
        response = {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: {
              name: 'runbook-ai',
              version: '1.0.0',
            },
            capabilities: {
              tools: {},
            },
          },
        };
      } else {
        response = {
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32601,
            message: `Method not found: ${message.method}`,
          },
        };
      }

      console.log(JSON.stringify(response));
    } catch (error) {
      console.log(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: `Parse error: ${error instanceof Error ? error.message : String(error)}`,
          },
        })
      );
    }
  });

  rl.on('close', () => {
    server.close();
    process.exit(0);
  });
}
