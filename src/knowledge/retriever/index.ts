/**
 * Knowledge Retriever
 *
 * Coordinates knowledge retrieval from multiple sources and stores.
 * Uses hybrid retrieval (FTS + vector) when embeddings are available.
 */

import { existsSync, mkdirSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';
import { loadConfig, type Config } from '../../utils/config';
import { configure as configureEmbedder, isEmbedderConfigured } from '../indexer/embedder';
import { loadFromSource } from '../sources';
import { KnowledgeStore } from '../store/sqlite';
import { VectorStore } from '../store/vector-store';
import type {
  RetrievedKnowledge,
  KnowledgeType,
  KnowledgeSourceConfig,
  FilesystemSourceConfig,
  KnowledgeDocument,
  ApiSourceConfig,
} from '../types';

const DEFAULT_LIMIT = 20;
const DEFAULT_RRF_K = 60;
const DEFAULT_FTS_WEIGHT = 0.45;
const DEFAULT_VECTOR_WEIGHT = 0.55;

export interface RetrieverConfig {
  storePath: string;
  sources: KnowledgeSourceConfig[];
  vectorStorePath?: string;
  defaultTopK?: number;
  rerank?: boolean;
  ftsWeight?: number;
  vectorWeight?: number;
  rrfK?: number;
}

export class KnowledgeRetriever {
  private store: KnowledgeStore;
  private vectorStore: VectorStore | null = null;
  private config: RetrieverConfig;
  private initialized = false;
  private vectorSearchEnabled = true;

  constructor(config: RetrieverConfig) {
    this.config = config;

    const storeDir = dirname(resolve(config.storePath));
    if (!existsSync(storeDir)) {
      mkdirSync(storeDir, { recursive: true });
    }

    this.store = new KnowledgeStore(config.storePath);

    if (isEmbedderConfigured()) {
      const vectorPath = this.resolveVectorStorePath(config.storePath, config.vectorStorePath);
      const vectorDir = dirname(resolve(vectorPath));
      if (!existsSync(vectorDir)) {
        mkdirSync(vectorDir, { recursive: true });
      }
      this.vectorStore = new VectorStore(vectorPath);
    }
  }

  private resolveVectorStorePath(storePath: string, explicitPath?: string): string {
    if (explicitPath && explicitPath.trim().length > 0) {
      return explicitPath;
    }
    return join(dirname(storePath), 'vectors.db');
  }

  /**
   * Sync knowledge from all configured sources
   */
  async sync(): Promise<{ added: number; updated: number }> {
    let added = 0;
    let updated = 0;

    for (const source of this.config.sources) {
      const lastSync = 'lastSyncTime' in source ? source.lastSyncTime : undefined;
      const documents = await loadFromSource(source, { since: lastSync });

      for (const doc of documents) {
        const existing = this.store.getDocument(doc.id);
        if (existing) {
          updated++;
        } else {
          added++;
        }

        this.store.upsertDocument(doc);
        await this.indexDocumentEmbeddings(doc, existing);
      }

      // Update lastSyncTime for incremental sync support.
      // This is in-memory only until config persistence is added.
      if ('lastSyncTime' in source) {
        (source as { lastSyncTime?: string }).lastSyncTime = new Date().toISOString();
      }
    }

    this.initialized = true;
    return { added, updated };
  }

  private async indexDocumentEmbeddings(
    doc: KnowledgeDocument,
    existing: KnowledgeDocument | null
  ): Promise<void> {
    if (!this.vectorStore || !this.vectorSearchEnabled) {
      return;
    }

    const hasEmbeddings = this.vectorStore.hasDocument(doc.id);
    const unchanged =
      Boolean(existing) &&
      existing?.updatedAt === doc.updatedAt &&
      existing?.content === doc.content &&
      hasEmbeddings;

    if (unchanged) {
      return;
    }

    try {
      this.vectorStore.deleteDocument(doc.id);
      if (doc.chunks.length === 0) {
        return;
      }

      await this.vectorStore.addChunks(
        doc.chunks.map((chunk) => ({
          chunk,
          documentTitle: doc.title,
          type: doc.type,
          services: doc.services,
        }))
      );
    } catch (error) {
      this.vectorSearchEnabled = false;
      console.warn(
        'Vector indexing disabled for current process due to embedding/indexing error:',
        error
      );
    }
  }

  /**
   * Initialize if not already done
   */
  async ensureInitialized(): Promise<void> {
    if (!this.initialized && this.store.getDocumentCount() === 0) {
      await this.sync();
    }
    this.initialized = true;
  }

  /**
   * Search for relevant knowledge
   */
  async search(
    query: string,
    options: {
      typeFilter?: KnowledgeType[];
      serviceFilter?: string[];
      limit?: number;
      rerank?: boolean;
    } = {}
  ): Promise<RetrievedKnowledge> {
    await this.ensureInitialized();

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return {
        runbooks: [],
        postmortems: [],
        architecture: [],
        knownIssues: [],
      };
    }

    const limit = options.limit || this.config.defaultTopK || DEFAULT_LIMIT;
    const rerank = options.rerank ?? this.config.rerank ?? true;
    const fusionLimit = Math.max(limit, Math.min(limit * 3, 100));

    const ftsResults = this.store.search(trimmedQuery, {
      typeFilter: options.typeFilter,
      serviceFilter: options.serviceFilter,
      limit: fusionLimit,
    });

    let allResults = ftsResults;
    if (rerank && this.vectorStore && this.vectorSearchEnabled) {
      try {
        const vectorResults = await this.vectorStore.search(trimmedQuery, {
          topK: fusionLimit,
          typeFilter: options.typeFilter,
          serviceFilter: options.serviceFilter,
          minScore: 0.15,
        });

        if (vectorResults.length > 0) {
          allResults = this.combineHybridResults(trimmedQuery, ftsResults, vectorResults, {
            topK: limit,
            serviceFilter: options.serviceFilter,
          });
        }
      } catch (error) {
        this.vectorSearchEnabled = false;
        console.warn('Vector search disabled for current process:', error);
      }
    }

    const knowledge: RetrievedKnowledge = {
      runbooks: [],
      postmortems: [],
      architecture: [],
      knownIssues: [],
    };

    for (const chunk of allResults.slice(0, limit)) {
      switch (chunk.type) {
        case 'runbook':
          knowledge.runbooks.push(chunk);
          break;
        case 'postmortem':
          knowledge.postmortems.push(chunk);
          break;
        case 'architecture':
          knowledge.architecture.push(chunk);
          break;
        case 'known_issue':
          knowledge.knownIssues.push(chunk);
          break;
      }
    }

    return knowledge;
  }

  private combineHybridResults(
    query: string,
    ftsResults: ReturnType<KnowledgeStore['search']>,
    vectorResults: Awaited<ReturnType<VectorStore['search']>>,
    options: {
      topK: number;
      serviceFilter?: string[];
    }
  ): ReturnType<KnowledgeStore['search']> {
    const rrfK = this.config.rrfK ?? DEFAULT_RRF_K;
    const ftsWeight = this.config.ftsWeight ?? DEFAULT_FTS_WEIGHT;
    const vectorWeight = this.config.vectorWeight ?? DEFAULT_VECTOR_WEIGHT;
    const intentBoostByType = this.getIntentBoostByType(query);

    const merged = new Map<
      string,
      {
        chunk: ReturnType<KnowledgeStore['search']>[number];
        score: number;
      }
    >();

    for (let i = 0; i < ftsResults.length; i++) {
      const chunk = ftsResults[i];
      const contribution = ftsWeight * (1 / (rrfK + i + 1));
      const existing = merged.get(chunk.id);
      if (existing) {
        existing.score += contribution;
      } else {
        merged.set(chunk.id, { chunk, score: contribution });
      }
    }

    for (let i = 0; i < vectorResults.length; i++) {
      const chunk = vectorResults[i];
      const contribution = vectorWeight * (1 / (rrfK + i + 1));
      const existing = merged.get(chunk.id);
      if (existing) {
        existing.score += contribution;
      } else {
        merged.set(chunk.id, { chunk, score: contribution });
      }
    }

    for (const value of merged.values()) {
      const typeBoost = intentBoostByType.get(value.chunk.type) || 0;
      value.score += typeBoost;

      if (options.serviceFilter && options.serviceFilter.length > 0) {
        const overlap = options.serviceFilter.filter((service) =>
          value.chunk.services.includes(service)
        ).length;
        if (overlap > 0) {
          value.score += Math.min(0.08, overlap * 0.02);
        }
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, options.topK)
      .map((item) => ({
        ...item.chunk,
        score: item.score,
      }));
  }

  private getIntentBoostByType(query: string): Map<KnowledgeType, number> {
    const q = query.toLowerCase();
    const boost = new Map<KnowledgeType, number>();

    if (q.includes('runbook') || q.includes('playbook') || q.includes('how to')) {
      boost.set('runbook', 0.06);
      boost.set('playbook', 0.04);
    }
    if (q.includes('postmortem') || q.includes('incident') || q.includes('root cause')) {
      boost.set('postmortem', 0.05);
      boost.set('known_issue', 0.03);
    }
    if (
      q.includes('architecture') ||
      q.includes('dependency') ||
      q.includes('topology') ||
      q.includes('design')
    ) {
      boost.set('architecture', 0.06);
    }
    if (q.includes('known issue') || q.includes('workaround') || q.includes('mitigation')) {
      boost.set('known_issue', 0.06);
    }

    return boost;
  }

  /**
   * Get runbooks for specific services
   */
  async getRunbooksForService(serviceName: string): Promise<RetrievedKnowledge> {
    return this.search(serviceName, {
      typeFilter: ['runbook'],
      serviceFilter: [serviceName],
    });
  }

  /**
   * Get document count
   */
  getDocumentCount(): number {
    return this.store.getDocumentCount();
  }

  /**
   * Get document counts grouped by type.
   */
  getDocumentCountsByType(): Record<KnowledgeType, number> {
    return this.store.getDocumentCountsByType();
  }

  /**
   * Get all stored documents.
   */
  getAllDocuments(): KnowledgeDocument[] {
    return this.store.getAllDocuments();
  }

  /**
   * Close stores.
   */
  close(): void {
    this.store.close();
    this.vectorStore?.close();
  }
}

function buildDefaultSources(baseDir: string): FilesystemSourceConfig[] {
  const sources: FilesystemSourceConfig[] = [
    {
      type: 'filesystem',
      path: join(baseDir, 'runbooks'),
      filePatterns: ['**/*.md', '**/*.yaml', '**/*.yml'],
    },
  ];

  if (existsSync('examples/runbooks')) {
    sources.push({
      type: 'filesystem',
      path: 'examples/runbooks',
      filePatterns: ['**/*.md'],
    });
  }

  return sources;
}

function resolvePathLike(value: string): string {
  if (isAbsolute(value)) {
    return value;
  }
  return resolve(process.cwd(), value);
}

function normalizeApiAuth(value: unknown): ApiSourceConfig['auth'] | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  const type = obj.type;
  const authValue = obj.value;
  if (
    (type === 'bearer' || type === 'basic' || type === 'header') &&
    typeof authValue === 'string' &&
    authValue.trim().length > 0
  ) {
    return {
      type,
      value: authValue,
    };
  }

  // Backward compatibility: treat legacy auth.apiToken as bearer token.
  const legacyToken = obj.apiToken;
  if (typeof legacyToken === 'string' && legacyToken.trim().length > 0) {
    return {
      type: 'bearer',
      value: legacyToken,
    };
  }

  // Backward compatibility: treat legacy auth header as "Header: value".
  const legacyEmail = obj.email;
  if (typeof legacyEmail === 'string' && legacyEmail.trim().length > 0) {
    return {
      type: 'header',
      value: legacyEmail,
    };
  }

  return undefined;
}

function readOptionalStringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return undefined;
}

function readConfluenceAuth(
  auth: Config['knowledge']['sources'][number]['auth']
): { email: string; apiToken: string } | null {
  if (!auth || typeof auth !== 'object') {
    return null;
  }

  const authRecord = auth as Record<string, unknown>;
  const email = readOptionalStringField(authRecord, 'email');
  const apiToken = readOptionalStringField(authRecord, 'apiToken');
  if (!email || !apiToken) {
    return null;
  }

  return { email, apiToken };
}

function readLegacyApiToken(
  auth: Config['knowledge']['sources'][number]['auth']
): string | undefined {
  if (!auth || typeof auth !== 'object') {
    return undefined;
  }

  const authRecord = auth as Record<string, unknown>;
  return readOptionalStringField(authRecord, 'apiToken');
}

function normalizeConfiguredSources(
  sources: Config['knowledge']['sources'],
  baseDir: string
): KnowledgeSourceConfig[] {
  const normalized: KnowledgeSourceConfig[] = [];

  for (const source of sources) {
    switch (source.type) {
      case 'filesystem': {
        if (!source.path || source.path.trim().length === 0) {
          console.warn('Skipping filesystem knowledge source without path.');
          continue;
        }
        normalized.push({
          type: 'filesystem',
          path: resolvePathLike(source.path),
          filePatterns: ['**/*.md', '**/*.yaml', '**/*.yml'],
          watch: source.watch,
        });
        break;
      }

      case 'confluence': {
        const auth = readConfluenceAuth(source.auth);
        if (!source.baseUrl || !source.spaceKey || !auth) {
          console.warn('Skipping incomplete Confluence knowledge source.');
          continue;
        }
        normalized.push({
          type: 'confluence',
          baseUrl: source.baseUrl,
          spaceKey: source.spaceKey,
          labels: source.labels,
          auth: {
            email: auth.email,
            apiToken: auth.apiToken,
          },
          lastSyncTime: source.lastSyncTime,
        });
        break;
      }

      case 'google_drive': {
        if (
          !source.folderIds ||
          source.folderIds.length === 0 ||
          !source.clientId ||
          !source.clientSecret
        ) {
          console.warn('Skipping incomplete Google Drive knowledge source.');
          continue;
        }
        normalized.push({
          type: 'google_drive',
          folderIds: source.folderIds,
          clientId: source.clientId,
          clientSecret: source.clientSecret,
          refreshToken: source.refreshToken,
          mimeTypes: source.mimeTypes,
          includeSubfolders: source.includeSubfolders,
          lastSyncTime: source.lastSyncTime,
        });
        break;
      }

      case 'notion': {
        const sourceRecord = source as Record<string, unknown>;
        const notionApiKey =
          readOptionalStringField(sourceRecord, 'apiKey') ||
          readLegacyApiToken(source.auth) ||
          process.env.RUNBOOK_NOTION_API_KEY ||
          process.env.NOTION_API_KEY;

        if (!source.databaseId || !notionApiKey) {
          console.warn('Skipping incomplete Notion knowledge source.');
          continue;
        }
        normalized.push({
          type: 'notion',
          databaseId: source.databaseId,
          apiKey: notionApiKey,
        });
        break;
      }

      case 'github': {
        if (!source.repo) {
          console.warn('Skipping incomplete GitHub knowledge source.');
          continue;
        }
        const sourceRecord = source as Record<string, unknown>;
        const explicitToken = readOptionalStringField(sourceRecord, 'token');
        normalized.push({
          type: 'github',
          repo: source.repo,
          branch: source.branch || 'main',
          path: source.path || '',
          token:
            explicitToken ||
            readLegacyApiToken(source.auth) ||
            process.env.RUNBOOK_GITHUB_TOKEN ||
            process.env.GITHUB_TOKEN,
        });
        break;
      }

      case 'api': {
        if (!source.endpoint) {
          console.warn('Skipping API knowledge source without endpoint.');
          continue;
        }
        normalized.push({
          type: 'api',
          endpoint: source.endpoint,
          auth: normalizeApiAuth(source.auth),
        });
        break;
      }

      default: {
        console.warn(`Unsupported knowledge source type: ${source.type}`);
        break;
      }
    }
  }

  if (normalized.length === 0) {
    return buildDefaultSources(baseDir);
  }

  return normalized;
}

function resolveConfigPathForBaseDir(baseDir: string): string | undefined {
  const yamlPath = join(baseDir, 'config.yaml');
  if (existsSync(yamlPath)) {
    return yamlPath;
  }
  const ymlPath = join(baseDir, 'config.yml');
  if (existsSync(ymlPath)) {
    return ymlPath;
  }
  return undefined;
}

/**
 * Create a retriever with default local filesystem sources.
 */
export function createRetriever(baseDir: string = '.runbook'): KnowledgeRetriever {
  const storePath = join(baseDir, 'knowledge.db');
  return new KnowledgeRetriever({
    storePath,
    vectorStorePath: join(baseDir, 'vectors.db'),
    sources: buildDefaultSources(baseDir),
  });
}

/**
 * Create a retriever from runtime config when available.
 */
export async function createConfiguredRetriever(
  baseDir: string = '.runbook',
  runtimeConfig?: Config
): Promise<KnowledgeRetriever> {
  const configPath = resolveConfigPathForBaseDir(baseDir);
  const config = runtimeConfig ?? (await loadConfig(configPath));

  const embedderApiKey =
    process.env.OPENAI_API_KEY ||
    (config.llm.provider === 'openai' ? (config.llm.apiKey ?? undefined) : undefined);
  if (embedderApiKey) {
    configureEmbedder(embedderApiKey, {
      model: config.knowledge.store.embeddingModel,
    });
  }

  const configuredStorePath = config.knowledge.store.path?.trim();
  const storePath = configuredStorePath
    ? resolvePathLike(configuredStorePath)
    : resolvePathLike(join(baseDir, 'knowledge.db'));
  const vectorStorePath = join(dirname(storePath), 'vectors.db');
  const sources = normalizeConfiguredSources(config.knowledge.sources, baseDir);

  return new KnowledgeRetriever({
    storePath,
    vectorStorePath,
    sources,
    defaultTopK: config.knowledge.retrieval.topK,
    rerank: config.knowledge.retrieval.rerank,
  });
}
