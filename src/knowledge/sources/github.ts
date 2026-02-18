/**
 * GitHub Knowledge Source
 *
 * Loads runbooks and knowledge documents from a GitHub repository.
 * Uses the Git Tree + Blob APIs for efficient recursive file retrieval.
 */

import matter from 'gray-matter';
import { parse as parseYaml } from 'yaml';
import type {
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeType,
  GitHubSourceConfig,
} from '../types';
import type { LoadOptions } from './index';

const GITHUB_API_BASE = 'https://api.github.com';
const SUPPORTED_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.yaml', '.yml']);

interface GitTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
}

interface GitTreeResponse {
  sha: string;
  truncated: boolean;
  tree: GitTreeEntry[];
}

interface GitBlobResponse {
  content: string;
  encoding: 'base64' | string;
}

interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export async function loadFromGitHub(
  config: GitHubSourceConfig,
  _options: LoadOptions = {}
): Promise<KnowledgeDocument[]> {
  const repoRef = parseRepository(config.repo);
  const branch = (config.branch || 'main').trim();
  const pathPrefix = normalizePathPrefix(config.path);
  const headers = buildHeaders(config.token);

  const tree = await fetchGitTree(repoRef, branch, headers);

  const candidateFiles = tree.tree.filter((entry) => {
    if (entry.type !== 'blob') {
      return false;
    }

    if (!isSupportedFile(entry.path)) {
      return false;
    }

    if (!pathPrefix) {
      return true;
    }

    return entry.path === pathPrefix || entry.path.startsWith(`${pathPrefix}/`);
  });

  const documents: KnowledgeDocument[] = [];
  for (const entry of candidateFiles) {
    const blob = await fetchBlob(repoRef, entry.sha, headers);
    const content = decodeBlobContent(blob);
    if (!content.trim()) {
      continue;
    }

    const doc = parseDocumentFromBlob({
      repo: repoRef,
      branch,
      config,
      path: entry.path,
      content,
    });
    if (doc) {
      documents.push(doc);
    }
  }

  return documents;
}

function parseRepository(input: string): GitHubRepoRef {
  const raw = input.trim();
  if (!raw) {
    throw new Error('GitHub source repo is required (format: owner/repo).');
  }

  // owner/repo format
  if (!raw.includes('://')) {
    const parts = raw
      .replace(/\.git$/, '')
      .split('/')
      .filter(Boolean);
    if (parts.length !== 2) {
      throw new Error(`Invalid GitHub repo format "${input}". Expected "owner/repo".`);
    }
    return { owner: parts[0], repo: parts[1] };
  }

  // https://github.com/owner/repo(.git)
  const url = new URL(raw);
  const parts = url.pathname
    .replace(/^\//, '')
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean);
  if (url.hostname !== 'github.com' || parts.length < 2) {
    throw new Error(`Invalid GitHub repository URL "${input}".`);
  }

  return { owner: parts[0], repo: parts[1] };
}

function normalizePathPrefix(pathValue: string): string {
  return pathValue.trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

function isSupportedFile(path: string): boolean {
  const lower = path.toLowerCase();
  const idx = lower.lastIndexOf('.');
  if (idx === -1) {
    return false;
  }
  return SUPPORTED_EXTENSIONS.has(lower.slice(idx));
}

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'runbook-ai',
  };
  if (token && token.trim().length > 0) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

async function fetchGitTree(
  repo: GitHubRepoRef,
  branch: string,
  headers: Record<string, string>
): Promise<GitTreeResponse> {
  const url = `${GITHUB_API_BASE}/repos/${repo.owner}/${repo.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const response = await fetch(url, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub tree API error (${response.status}): ${body}`);
  }

  return (await response.json()) as GitTreeResponse;
}

async function fetchBlob(
  repo: GitHubRepoRef,
  sha: string,
  headers: Record<string, string>
): Promise<GitBlobResponse> {
  const url = `${GITHUB_API_BASE}/repos/${repo.owner}/${repo.repo}/git/blobs/${sha}`;
  const response = await fetch(url, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub blob API error (${response.status}): ${body}`);
  }

  return (await response.json()) as GitBlobResponse;
}

function decodeBlobContent(blob: GitBlobResponse): string {
  if (blob.encoding !== 'base64') {
    throw new Error(`Unsupported GitHub blob encoding: ${blob.encoding}`);
  }

  // Blob payloads may include line breaks.
  const normalized = blob.content.replace(/\s+/g, '');
  return Buffer.from(normalized, 'base64').toString('utf-8');
}

function parseDocumentFromBlob(input: {
  repo: GitHubRepoRef;
  branch: string;
  config: GitHubSourceConfig;
  path: string;
  content: string;
}): KnowledgeDocument | null {
  const now = new Date().toISOString();
  const lower = input.path.toLowerCase();

  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')) {
    const parsed = matter(input.content);
    const frontmatter = parsed.data as Record<string, unknown>;
    const body = parsed.content.trim();
    if (!body) {
      return null;
    }

    const title =
      (typeof frontmatter.title === 'string' ? frontmatter.title : undefined) ||
      extractMarkdownTitle(body) ||
      basenameWithoutExt(input.path);

    const type =
      (typeof frontmatter.type === 'string' ? (frontmatter.type as KnowledgeType) : undefined) ||
      inferType(input.path, body);
    const services = normalizeStringArray(frontmatter.services);
    const tags = normalizeStringArray(frontmatter.tags);
    const symptoms = normalizeStringArray(frontmatter.symptoms);
    const severity = normalizeSeverity(frontmatter.severity);

    const id = buildDocumentId(input.repo, input.path);
    return {
      id,
      source: {
        type: 'github',
        name: `${input.repo.owner}/${input.repo.repo}`,
        config: input.config,
      },
      type,
      title,
      content: body,
      chunks: chunkMarkdown(id, body),
      services,
      tags,
      severityRelevance: severity ? [severity] : [],
      symptoms,
      createdAt: now,
      updatedAt: now,
      sourceUrl: `https://github.com/${input.repo.owner}/${input.repo.repo}/blob/${input.branch}/${input.path}`,
      author: typeof frontmatter.author === 'string' ? frontmatter.author : undefined,
      lastValidated:
        typeof frontmatter.lastValidated === 'string' ? frontmatter.lastValidated : undefined,
    };
  }

  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
    const data = parseYaml(input.content) as Record<string, unknown>;
    const title =
      (typeof data.title === 'string' ? data.title : undefined) || basenameWithoutExt(input.path);
    const type =
      (typeof data.type === 'string' ? (data.type as KnowledgeType) : undefined) || 'environment';
    const services = normalizeStringArray(data.services);
    const tags = normalizeStringArray(data.tags);
    const id = buildDocumentId(input.repo, input.path);
    const yamlContent = JSON.stringify(data, null, 2);

    return {
      id,
      source: {
        type: 'github',
        name: `${input.repo.owner}/${input.repo.repo}`,
        config: input.config,
      },
      type,
      title,
      content: yamlContent,
      chunks: [
        {
          id: `${id}_0`,
          documentId: id,
          content: yamlContent,
          chunkType: 'reference',
        },
      ],
      services,
      tags,
      severityRelevance: [],
      createdAt: now,
      updatedAt: now,
      sourceUrl: `https://github.com/${input.repo.owner}/${input.repo.repo}/blob/${input.branch}/${input.path}`,
    };
  }

  return null;
}

function buildDocumentId(repo: GitHubRepoRef, path: string): string {
  return `github_${repo.owner}_${repo.repo}_${path}`.replace(/[^a-zA-Z0-9]/g, '_');
}

function basenameWithoutExt(path: string): string {
  const parts = path.split('/');
  const base = parts[parts.length - 1];
  return base.replace(/\.[^.]+$/, '');
}

function extractMarkdownTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function normalizeSeverity(value: unknown): 'sev1' | 'sev2' | 'sev3' | null {
  if (value === 'sev1' || value === 'sev2' || value === 'sev3') {
    return value;
  }
  return null;
}

function inferType(path: string, content: string): KnowledgeType {
  const lowerPath = path.toLowerCase();
  const lowerContent = content.toLowerCase();

  if (lowerPath.includes('runbook') || lowerContent.includes('## mitigation')) {
    return 'runbook';
  }
  if (
    lowerPath.includes('postmortem') ||
    lowerPath.includes('post-mortem') ||
    lowerContent.includes('root cause')
  ) {
    return 'postmortem';
  }
  if (lowerPath.includes('architecture') || lowerContent.includes('## components')) {
    return 'architecture';
  }
  if (lowerPath.includes('known-issue') || lowerPath.includes('known_issue')) {
    return 'known_issue';
  }

  return 'runbook';
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
