/**
 * API Knowledge Source
 *
 * Loads runbooks and knowledge documents from a generic HTTP endpoint.
 * Supports JSON payloads (array/object) and plain text responses.
 */

import { createHash } from 'crypto';
import type { ApiSourceConfig, KnowledgeChunk, KnowledgeDocument, KnowledgeType } from '../types';
import type { LoadOptions } from './index';

type Severity = 'sev1' | 'sev2' | 'sev3';

const SOURCE_NAME = 'api';
const JSON_CONTENT_TYPE = 'application/json';

type ApiRecord = Record<string, unknown>;

/**
 * Load knowledge documents from a generic API endpoint.
 */
export async function loadFromApi(
  config: ApiSourceConfig,
  options: LoadOptions = {}
): Promise<KnowledgeDocument[]> {
  const endpoint = buildEndpoint(config.endpoint, options.since);
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: buildHeaders(config),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API knowledge source failed (${response.status}): ${errorText}`);
  }

  const raw = await response.text();
  if (!raw.trim()) {
    return [];
  }

  const contentType = response.headers.get('content-type') || '';
  const shouldParseAsJson = contentType.includes(JSON_CONTENT_TYPE) || looksLikeJson(raw);

  if (shouldParseAsJson) {
    const parsed = safeJsonParse(raw);
    if (parsed === null) {
      throw new Error('API knowledge source returned invalid JSON payload');
    }

    return parseJsonPayload(parsed, config, options);
  }

  const document = buildTextDocument(raw, config, endpoint);
  return document ? [document] : [];
}

function buildEndpoint(endpoint: string, since?: string): string {
  if (!since) {
    return endpoint;
  }

  try {
    const url = new URL(endpoint);
    url.searchParams.set('since', since);
    return url.toString();
  } catch {
    return endpoint;
  }
}

function buildHeaders(config: ApiSourceConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain;q=0.9, text/markdown;q=0.8',
  };

  if (!config.auth || !config.auth.value.trim()) {
    return headers;
  }

  const authValue = config.auth.value.trim();

  switch (config.auth.type) {
    case 'bearer':
      headers.Authorization = `Bearer ${authValue}`;
      break;
    case 'basic':
      headers.Authorization = authValue.includes(':')
        ? `Basic ${Buffer.from(authValue).toString('base64')}`
        : `Basic ${authValue}`;
      break;
    case 'header': {
      const parsed = parseHeaderAuth(authValue);
      headers[parsed.name] = parsed.value;
      break;
    }
  }

  return headers;
}

function parseHeaderAuth(value: string): { name: string; value: string } {
  const separatorIndex = value.indexOf(':');
  if (separatorIndex === -1) {
    return { name: 'x-api-key', value };
  }

  const name = value.slice(0, separatorIndex).trim();
  const headerValue = value.slice(separatorIndex + 1).trim();

  if (!name || !headerValue) {
    return { name: 'x-api-key', value };
  }

  return { name, value: headerValue };
}

function looksLikeJson(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function safeJsonParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseJsonPayload(
  payload: unknown,
  config: ApiSourceConfig,
  options: LoadOptions
): KnowledgeDocument[] {
  const records = extractRecords(payload);
  if (records.length === 0) {
    return [];
  }

  const sinceDate = options.since ? new Date(options.since) : null;
  const documents: KnowledgeDocument[] = [];

  for (const record of records) {
    const document = normalizeRecord(record, config);
    if (!document) {
      continue;
    }

    if (sinceDate) {
      const updatedAt = new Date(document.updatedAt);
      if (!Number.isNaN(updatedAt.getTime()) && updatedAt <= sinceDate) {
        continue;
      }
    }

    documents.push(document);
  }

  return documents;
}

function extractRecords(payload: unknown): ApiRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter(isApiRecord);
  }

  if (!isApiRecord(payload)) {
    return [];
  }

  const arrayLikeKeys = ['documents', 'items', 'results', 'data', 'runbooks'];
  for (const key of arrayLikeKeys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(isApiRecord);
    }
  }

  if (hasContentFields(payload)) {
    return [payload];
  }

  return [];
}

function hasContentFields(record: ApiRecord): boolean {
  return (
    typeof record.content === 'string' ||
    typeof record.body === 'string' ||
    typeof record.markdown === 'string' ||
    typeof record.text === 'string'
  );
}

function normalizeRecord(record: ApiRecord, config: ApiSourceConfig): KnowledgeDocument | null {
  const content = firstString(record.markdown, record.content, record.body, record.text);
  if (!content) {
    return null;
  }

  const title = firstString(record.title, record.name) || extractTitle(content) || 'Untitled';
  const type = normalizeKnowledgeType(record.type) || inferTypeFromTitle(title);
  const sourceUrl = firstString(record.sourceUrl, record.url, record.link);
  const now = new Date().toISOString();
  const createdAt = firstString(record.createdAt, record.created_at, record.publishedAt) || now;
  const updatedAt =
    firstString(record.updatedAt, record.updated_at, record.lastUpdated, record.modifiedAt) ||
    createdAt;
  const idCandidate = firstString(record.id, record.slug);
  const id = buildDocumentId(idCandidate, title, updatedAt, content);
  const symptoms = toStringList(record.symptoms);

  return {
    id,
    source: {
      type: 'api',
      name: SOURCE_NAME,
      config,
    },
    type,
    title,
    content,
    chunks: chunkMarkdown(id, content),
    services: toStringList(record.services),
    tags: toStringList(record.tags),
    symptoms,
    severityRelevance: normalizeSeverities(record.severityRelevance ?? record.severity),
    createdAt,
    updatedAt,
    sourceUrl: sourceUrl || undefined,
    author: firstString(record.author) || undefined,
    lastValidated: firstString(record.lastValidated) || undefined,
  };
}

function buildTextDocument(
  content: string,
  config: ApiSourceConfig,
  sourceUrl: string
): KnowledgeDocument | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  const title = extractTitle(trimmed) || 'API Knowledge';
  const now = new Date().toISOString();
  const id = buildDocumentId(null, title, now, trimmed);

  return {
    id,
    source: {
      type: 'api',
      name: SOURCE_NAME,
      config,
    },
    type: inferTypeFromTitle(title),
    title,
    content: trimmed,
    chunks: chunkMarkdown(id, trimmed),
    services: [],
    tags: [],
    symptoms: [],
    severityRelevance: [],
    createdAt: now,
    updatedAt: now,
    sourceUrl,
  };
}

function buildDocumentId(
  idCandidate: string | null,
  title: string,
  updatedAt: string,
  content: string
): string {
  if (idCandidate) {
    return `api_${sanitizeForId(idCandidate)}`;
  }

  const hash = createHash('sha1')
    .update(`${title}|${updatedAt}|${content.slice(0, 256)}`)
    .digest('hex')
    .slice(0, 16);
  return `api_${hash}`;
}

function sanitizeForId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function isApiRecord(value: unknown): value is ApiRecord {
  return typeof value === 'object' && value !== null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/[,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeKnowledgeType(value: unknown): KnowledgeType | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  const aliasMap: Record<string, KnowledgeType> = {
    runbook: 'runbook',
    playbook: 'playbook',
    postmortem: 'postmortem',
    'post-mortem': 'postmortem',
    architecture: 'architecture',
    ownership: 'ownership',
    known_issue: 'known_issue',
    'known-issue': 'known_issue',
    environment: 'environment',
    faq: 'faq',
  };

  return aliasMap[normalized] || null;
}

function inferTypeFromTitle(title: string): KnowledgeType {
  const lower = title.toLowerCase();
  if (lower.includes('postmortem') || lower.includes('post-mortem')) return 'postmortem';
  if (lower.includes('architecture') || lower.includes('design')) return 'architecture';
  if (lower.includes('known issue') || lower.includes('workaround')) return 'known_issue';
  if (lower.includes('playbook')) return 'playbook';
  if (lower.includes('faq')) return 'faq';
  return 'runbook';
}

function normalizeSeverities(value: unknown): Severity[] {
  const values = Array.isArray(value) ? value : [value];
  const severities: Severity[] = [];

  for (const entry of values) {
    if (typeof entry !== 'string') {
      continue;
    }

    const normalized = entry.trim().toLowerCase();
    if (normalized === 'sev1' || normalized === 'p1' || normalized === 'critical') {
      severities.push('sev1');
      continue;
    }
    if (normalized === 'sev2' || normalized === 'p2' || normalized === 'high') {
      severities.push('sev2');
      continue;
    }
    if (normalized === 'sev3' || normalized === 'p3' || normalized === 'medium') {
      severities.push('sev3');
    }
  }

  return Array.from(new Set(severities));
}

function extractTitle(content: string): string | null {
  const header = content.match(/^#\s+(.+)$/m);
  if (header?.[1]) {
    return header[1].trim();
  }

  const firstLine = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstLine || null;
}

function chunkMarkdown(documentId: string, content: string): KnowledgeChunk[] {
  const lines = content.split('\n');
  const chunks: KnowledgeChunk[] = [];

  let currentLines: string[] = [];
  let currentTitle: string | undefined;
  let chunkIndex = 0;
  let lineStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^#{1,3}\s+/.test(line)) {
      if (currentLines.length > 0) {
        chunks.push({
          id: `${documentId}_${chunkIndex++}`,
          documentId,
          content: currentLines.join('\n').trim(),
          sectionTitle: currentTitle,
          chunkType: inferChunkType(currentLines.join('\n')),
          lineStart,
          lineEnd: i - 1,
        });
      }
      currentTitle = line.replace(/^#+\s+/, '').trim();
      currentLines = [line];
      lineStart = i;
      continue;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    chunks.push({
      id: `${documentId}_${chunkIndex}`,
      documentId,
      content: currentLines.join('\n').trim(),
      sectionTitle: currentTitle,
      chunkType: inferChunkType(currentLines.join('\n')),
      lineStart,
      lineEnd: lines.length - 1,
    });
  }

  return chunks;
}

function inferChunkType(content: string): KnowledgeChunk['chunkType'] {
  const lower = content.toLowerCase();
  if (content.includes('```')) return 'command';
  if (lower.includes('step') || lower.includes('[ ]') || lower.includes('[x]')) return 'procedure';
  if (lower.includes('if ') || lower.includes('when ') || lower.includes('decision'))
    return 'decision';
  if (lower.includes('symptom') || lower.includes('overview') || lower.includes('background'))
    return 'context';
  return 'reference';
}
