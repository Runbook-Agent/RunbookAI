/**
 * Notion Knowledge Source
 *
 * Loads runbooks and knowledge docs from a Notion database.
 * Fetches page properties and page block content, then normalizes to markdown.
 */

import type {
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeType,
  NotionSourceConfig,
} from '../types';
import type { LoadOptions } from './index';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

interface NotionQueryResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

interface NotionPage {
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, NotionProperty>;
}

type NotionProperty =
  | {
      type: 'title';
      title?: Array<{ plain_text?: string }>;
    }
  | {
      type: 'rich_text';
      rich_text?: Array<{ plain_text?: string }>;
    }
  | {
      type: 'select';
      select?: { name?: string };
    }
  | {
      type: 'multi_select';
      multi_select?: Array<{ name?: string }>;
    }
  | {
      type: 'status';
      status?: { name?: string };
    }
  | {
      type: 'people';
      people?: Array<{ name?: string }>;
    }
  | {
      type: 'relation';
      relation?: Array<{ id?: string }>;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

interface NotionBlocksResponse {
  results: NotionBlock[];
  has_more: boolean;
  next_cursor: string | null;
}

interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

interface NotionRichTextItem {
  plain_text?: string;
}

export async function loadFromNotion(
  config: NotionSourceConfig,
  options: LoadOptions = {}
): Promise<KnowledgeDocument[]> {
  const headers = buildHeaders(config.apiKey);
  const pages = await queryDatabasePages(config, headers);
  const documents: KnowledgeDocument[] = [];
  const sinceDate = options.since ? new Date(options.since) : null;

  for (const page of pages) {
    if (sinceDate) {
      const edited = new Date(page.last_edited_time);
      if (!Number.isNaN(edited.getTime()) && edited <= sinceDate) {
        continue;
      }
    }

    const document = await processPage(page, config, headers);
    if (document) {
      documents.push(document);
    }
  }

  return documents;
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Notion-Version': NOTION_VERSION,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function queryDatabasePages(
  config: NotionSourceConfig,
  headers: Record<string, string>
): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | null = null;

  do {
    const body: Record<string, unknown> = {
      page_size: 100,
    };
    if (config.filter) {
      body.filter = config.filter;
    }
    if (cursor) {
      body.start_cursor = cursor;
    }

    const response = await fetch(`${NOTION_API_BASE}/databases/${config.databaseId}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Notion database query failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as NotionQueryResponse;
    pages.push(...payload.results);
    cursor = payload.has_more ? payload.next_cursor : null;
  } while (cursor);

  return pages;
}

async function processPage(
  page: NotionPage,
  config: NotionSourceConfig,
  headers: Record<string, string>
): Promise<KnowledgeDocument | null> {
  const title = extractTitle(page.properties) || 'Untitled';
  const services = extractNamedListProperty(page.properties, ['services', 'service']);
  const tags = extractNamedListProperty(page.properties, ['tags', 'tag']);
  const symptoms = extractNamedListProperty(page.properties, ['symptoms', 'symptom']);
  const docType = extractKnowledgeType(page.properties) || inferTypeFromTitle(title);
  const severity = extractSeverity(page.properties);

  const blocks = await fetchAllBlocks(page.id, headers);
  const markdown = blocksToMarkdown(blocks).trim();
  if (!markdown) {
    return null;
  }

  const id = `notion_${page.id.replace(/-/g, '')}`;
  return {
    id,
    source: {
      type: 'notion',
      name: 'notion',
      config,
    },
    type: docType,
    title,
    content: markdown,
    chunks: chunkMarkdown(id, markdown),
    services,
    tags,
    symptoms,
    severityRelevance: severity ? [severity] : [],
    createdAt: page.created_time,
    updatedAt: page.last_edited_time,
    sourceUrl: page.url,
  };
}

async function fetchAllBlocks(
  blockId: string,
  headers: Record<string, string>,
  depth: number = 0
): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | null = null;

  do {
    const url = new URL(`${NOTION_API_BASE}/blocks/${blockId}/children`);
    url.searchParams.set('page_size', '100');
    if (cursor) {
      url.searchParams.set('start_cursor', cursor);
    }

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Notion block retrieval failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as NotionBlocksResponse;
    for (const block of payload.results) {
      blocks.push(block);

      if (block.has_children && depth < 2) {
        const childBlocks = await fetchAllBlocks(block.id, headers, depth + 1);
        blocks.push(...childBlocks);
      }
    }

    cursor = payload.has_more ? payload.next_cursor : null;
  } while (cursor);

  return blocks;
}

function blocksToMarkdown(blocks: NotionBlock[]): string {
  const lines: string[] = [];

  for (const block of blocks) {
    const type = block.type;
    const payload = block[type] as Record<string, unknown> | undefined;
    const richText = (payload?.rich_text as NotionRichTextItem[] | undefined) || [];
    const text = richText
      .map((item) => item.plain_text || '')
      .join('')
      .trim();

    if (!text && type !== 'divider') {
      continue;
    }

    switch (type) {
      case 'heading_1':
        lines.push(`# ${text}`);
        break;
      case 'heading_2':
        lines.push(`## ${text}`);
        break;
      case 'heading_3':
        lines.push(`### ${text}`);
        break;
      case 'bulleted_list_item':
        lines.push(`- ${text}`);
        break;
      case 'numbered_list_item':
        lines.push(`1. ${text}`);
        break;
      case 'to_do': {
        const checked = Boolean(payload?.checked);
        lines.push(`- [${checked ? 'x' : ' '}] ${text}`);
        break;
      }
      case 'quote':
        lines.push(`> ${text}`);
        break;
      case 'code': {
        const language = String(payload?.language || '').trim();
        lines.push(`\`\`\`${language}`);
        lines.push(text);
        lines.push('```');
        break;
      }
      case 'divider':
        lines.push('---');
        break;
      default:
        lines.push(text);
        break;
    }

    lines.push('');
  }

  return lines.join('\n').trim();
}

function extractTitle(properties: Record<string, NotionProperty>): string | null {
  for (const property of Object.values(properties)) {
    if (property.type !== 'title') {
      continue;
    }

    const titleItems =
      (
        property as {
          title?: Array<{ plain_text?: string }>;
        }
      ).title || [];
    const text = titleItems
      .map((item) => item.plain_text || '')
      .join('')
      .trim();
    if (text) {
      return text;
    }
  }

  return null;
}

function extractNamedListProperty(
  properties: Record<string, NotionProperty>,
  candidateNames: string[]
): string[] {
  for (const [name, property] of Object.entries(properties)) {
    if (!candidateNames.includes(name.toLowerCase())) {
      continue;
    }

    if (property.type === 'multi_select') {
      const values =
        (
          property as {
            multi_select?: Array<{ name?: string }>;
          }
        ).multi_select || [];
      return values
        .map((entry) => entry.name || '')
        .map((entry) => entry.trim())
        .filter(Boolean);
    }

    if (property.type === 'select') {
      const value = (property as { select?: { name?: string } }).select?.name?.trim();
      return value ? [value] : [];
    }

    if (property.type === 'rich_text') {
      const values =
        (
          property as {
            rich_text?: Array<{ plain_text?: string }>;
          }
        ).rich_text || [];
      const value = values
        .map((entry) => entry.plain_text || '')
        .join(',')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      return value;
    }
  }

  return [];
}

function extractKnowledgeType(properties: Record<string, NotionProperty>): KnowledgeType | null {
  for (const [name, property] of Object.entries(properties)) {
    if (name.toLowerCase() !== 'type') {
      continue;
    }

    let rawValue = '';
    if (property.type === 'select') {
      rawValue = (property as { select?: { name?: string } }).select?.name || '';
    } else if (property.type === 'status') {
      rawValue = (property as { status?: { name?: string } }).status?.name || '';
    } else if (property.type === 'rich_text') {
      const values =
        (
          property as {
            rich_text?: Array<{ plain_text?: string }>;
          }
        ).rich_text || [];
      rawValue = values.map((entry) => entry.plain_text || '').join('');
    }

    const normalized = rawValue.trim().toLowerCase();
    if (
      normalized === 'runbook' ||
      normalized === 'postmortem' ||
      normalized === 'architecture' ||
      normalized === 'known_issue' ||
      normalized === 'ownership' ||
      normalized === 'environment' ||
      normalized === 'playbook' ||
      normalized === 'faq'
    ) {
      return normalized;
    }
  }

  return null;
}

function inferTypeFromTitle(title: string): KnowledgeType {
  const lower = title.toLowerCase();
  if (lower.includes('postmortem') || lower.includes('post-mortem')) {
    return 'postmortem';
  }
  if (lower.includes('architecture') || lower.includes('design')) {
    return 'architecture';
  }
  if (lower.includes('known issue') || lower.includes('workaround')) {
    return 'known_issue';
  }
  return 'runbook';
}

function extractSeverity(
  properties: Record<string, NotionProperty>
): 'sev1' | 'sev2' | 'sev3' | null {
  for (const [name, property] of Object.entries(properties)) {
    if (!['severity', 'priority'].includes(name.toLowerCase())) {
      continue;
    }

    let raw = '';
    if (property.type === 'select') {
      raw = (property as { select?: { name?: string } }).select?.name || '';
    } else if (property.type === 'status') {
      raw = (property as { status?: { name?: string } }).status?.name || '';
    } else if (property.type === 'rich_text') {
      const values =
        (
          property as {
            rich_text?: Array<{ plain_text?: string }>;
          }
        ).rich_text || [];
      raw = values.map((entry) => entry.plain_text || '').join('');
    }

    const normalized = raw.trim().toLowerCase();
    if (normalized === 'sev1' || normalized === 'p1' || normalized === 'critical') {
      return 'sev1';
    }
    if (normalized === 'sev2' || normalized === 'p2' || normalized === 'high') {
      return 'sev2';
    }
    if (normalized === 'sev3' || normalized === 'p3' || normalized === 'medium') {
      return 'sev3';
    }
  }

  return null;
}

function chunkMarkdown(documentId: string, content: string): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  const lines = content.split('\n');

  let currentChunk: string[] = [];
  let currentTitle: string | undefined;
  let chunkIndex = 0;
  let lineStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^#{1,3}\s+/)) {
      if (currentChunk.length > 0) {
        chunks.push({
          id: `${documentId}_${chunkIndex++}`,
          documentId,
          content: currentChunk.join('\n').trim(),
          sectionTitle: currentTitle,
          chunkType: inferChunkType(currentChunk.join('\n')),
          lineStart,
          lineEnd: i - 1,
        });
      }
      currentTitle = line.replace(/^#+\s+/, '').trim();
      currentChunk = [line];
      lineStart = i;
    } else {
      currentChunk.push(line);
    }
  }

  if (currentChunk.length > 0) {
    chunks.push({
      id: `${documentId}_${chunkIndex}`,
      documentId,
      content: currentChunk.join('\n').trim(),
      sectionTitle: currentTitle,
      chunkType: inferChunkType(currentChunk.join('\n')),
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
