/**
 * Filesystem Knowledge Source
 *
 * Loads runbooks and other knowledge documents from the local filesystem.
 * Supports markdown files with YAML frontmatter.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join, extname, basename } from 'path';
import { existsSync } from 'fs';
import matter from 'gray-matter';
import type {
  KnowledgeDocument,
  KnowledgeChunk,
  KnowledgeType,
  FilesystemSourceConfig,
} from '../types';

/**
 * Load all knowledge documents from a directory
 */
export async function loadFromFilesystem(
  config: FilesystemSourceConfig
): Promise<KnowledgeDocument[]> {
  const documents: KnowledgeDocument[] = [];

  if (!existsSync(config.path)) {
    return documents;
  }

  const files = await findFiles(config.path, config.filePatterns);

  for (const filePath of files) {
    try {
      const doc = await parseDocument(filePath);
      if (doc) {
        documents.push(doc);
      }
    } catch (error) {
      console.error(`Error parsing ${filePath}:`, error);
    }
  }

  return documents;
}

/**
 * Find all matching files in a directory
 */
async function findFiles(dir: string, patterns: string[]): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string) {
    const entries = await readdir(currentDir);

    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        await walk(fullPath);
      } else if (stats.isFile()) {
        const ext = extname(entry).toLowerCase();
        if (patterns.some((p) => p.includes(ext) || p === '**/*')) {
          files.push(fullPath);
        }
      }
    }
  }

  await walk(dir);
  return files;
}

/**
 * Parse a single document file
 */
async function parseDocument(filePath: string): Promise<KnowledgeDocument | null> {
  const content = await readFile(filePath, 'utf-8');
  const ext = extname(filePath).toLowerCase();

  if (ext === '.md' || ext === '.markdown') {
    return parseMarkdown(filePath, content);
  } else if (ext === '.yaml' || ext === '.yml') {
    return parseYaml(filePath, content);
  }

  return null;
}

/**
 * Parse a markdown file with optional frontmatter
 */
function parseMarkdown(filePath: string, content: string): KnowledgeDocument {
  const { data: frontmatter, content: body } = matter(content);

  const docType = (frontmatter.type as KnowledgeType) || inferType(filePath, body);
  const title = frontmatter.title || extractTitle(body) || basename(filePath, extname(filePath));
  const services = (frontmatter.services as string[]) || [];
  const tags = (frontmatter.tags as string[]) || [];
  const symptoms = (frontmatter.symptoms as string[]) || [];

  // Generate document ID from path
  const id = filePath.replace(/[^a-zA-Z0-9]/g, '_');

  // Chunk the content
  const chunks = chunkMarkdown(id, body);

  return {
    id,
    source: {
      type: 'filesystem',
      name: 'local',
      config: { type: 'filesystem', path: filePath, filePatterns: [] },
    },
    type: docType,
    title,
    content: body,
    chunks,
    services,
    tags,
    severityRelevance: frontmatter.severity ? [frontmatter.severity] : [],
    symptoms,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    author: frontmatter.author as string | undefined,
    sourceUrl: `file://${filePath}`,
    lastValidated: frontmatter.lastValidated as string | undefined,
  };
}

/**
 * Parse a YAML file (for structured data like service ownership)
 */
function parseYaml(filePath: string, content: string): KnowledgeDocument {
  const { data } = matter(`---\n${content}\n---\n`);

  const id = filePath.replace(/[^a-zA-Z0-9]/g, '_');
  const title = data.title || basename(filePath, extname(filePath));

  return {
    id,
    source: {
      type: 'filesystem',
      name: 'local',
      config: { type: 'filesystem', path: filePath, filePatterns: [] },
    },
    type: (data.type as KnowledgeType) || 'environment',
    title,
    content: JSON.stringify(data, null, 2),
    chunks: [
      {
        id: `${id}_0`,
        documentId: id,
        content: JSON.stringify(data, null, 2),
        chunkType: 'reference',
      },
    ],
    services: data.services || [],
    tags: data.tags || [],
    severityRelevance: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceUrl: `file://${filePath}`,
  };
}

/**
 * Infer document type from filename or content
 */
function inferType(filePath: string, content: string): KnowledgeType {
  const lowerPath = filePath.toLowerCase();
  const lowerContent = content.toLowerCase();

  if (lowerPath.includes('runbook') || lowerContent.includes('## mitigation')) {
    return 'runbook';
  }
  if (lowerPath.includes('postmortem') || lowerPath.includes('post-mortem') || lowerContent.includes('root cause')) {
    return 'postmortem';
  }
  if (lowerPath.includes('architecture') || lowerContent.includes('## components')) {
    return 'architecture';
  }
  if (lowerPath.includes('known-issue') || lowerPath.includes('known_issue')) {
    return 'known_issue';
  }

  return 'runbook'; // Default
}

/**
 * Extract title from markdown content (first H1)
 */
function extractTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Chunk markdown content by sections
 */
function chunkMarkdown(documentId: string, content: string): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  const lines = content.split('\n');

  let currentChunk: string[] = [];
  let currentTitle: string | undefined;
  let chunkIndex = 0;
  let lineStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for section headers
    if (line.match(/^#{1,3}\s+/)) {
      // Save previous chunk if exists
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

  // Save final chunk
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

/**
 * Infer chunk type from content
 */
function inferChunkType(content: string): KnowledgeChunk['chunkType'] {
  const lower = content.toLowerCase();

  if (content.includes('```')) {
    return 'command';
  }
  if (lower.includes('step') || lower.includes('[ ]') || lower.includes('[x]')) {
    return 'procedure';
  }
  if (lower.includes('if ') || lower.includes('when ') || lower.includes('decision')) {
    return 'decision';
  }
  if (lower.includes('symptom') || lower.includes('overview') || lower.includes('background')) {
    return 'context';
  }

  return 'reference';
}
