import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { stringify as stringifyYaml } from 'yaml';
import { createConfiguredRetriever } from '../index';

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'runbook-knowledge-'));
}

async function writeMarkdownFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, 'utf-8');
}

describe('KnowledgeRetriever configuration + ingestion', () => {
  const createdDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      createdDirs.splice(0).map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
      })
    );
  });

  it('loads configured filesystem sources from baseDir config', async () => {
    const baseDir = await createTempDir();
    createdDirs.push(baseDir);

    const sourceDir = join(baseDir, 'external-knowledge');
    await mkdir(sourceDir, { recursive: true });
    await writeMarkdownFile(
      join(sourceDir, 'checkout-timeout.md'),
      `---
type: runbook
services: [checkout]
---
# Checkout Timeout Recovery

Restart workers and verify queue depth.
`
    );

    await writeFile(
      join(baseDir, 'config.yaml'),
      stringifyYaml({
        knowledge: {
          sources: [
            {
              type: 'filesystem',
              path: sourceDir,
            },
          ],
          store: {
            path: join(baseDir, 'knowledge.db'),
          },
        },
      }),
      'utf-8'
    );

    const retriever = await createConfiguredRetriever(baseDir);
    try {
      const syncResult = await retriever.sync();
      expect(syncResult.added).toBe(1);

      const results = await retriever.search('checkout timeout');
      expect(results.runbooks.length).toBeGreaterThan(0);
      expect(results.runbooks[0].title).toContain('Checkout Timeout Recovery');
    } finally {
      retriever.close();
    }
  });

  it('falls back to default runbooks path when configured sources are invalid', async () => {
    const baseDir = await createTempDir();
    createdDirs.push(baseDir);

    const fallbackRunbooksDir = join(baseDir, 'runbooks');
    await mkdir(fallbackRunbooksDir, { recursive: true });
    await writeMarkdownFile(
      join(fallbackRunbooksDir, 'latency-guide.md'),
      `---
type: runbook
services: [api]
---
# API Latency Guide

Check connection pools and recent deploys.
`
    );

    await writeFile(
      join(baseDir, 'config.yaml'),
      stringifyYaml({
        knowledge: {
          sources: [
            {
              type: 'github',
            },
          ],
          store: {
            path: join(baseDir, 'knowledge.db'),
          },
        },
      }),
      'utf-8'
    );

    const retriever = await createConfiguredRetriever(baseDir);
    try {
      await retriever.sync();
      const results = await retriever.search('latency');
      expect(results.runbooks.length).toBeGreaterThan(0);
      expect(results.runbooks[0].title).toContain('API Latency Guide');
    } finally {
      retriever.close();
    }
  });

  it('uses configured retrieval.topK as the default search limit', async () => {
    const baseDir = await createTempDir();
    createdDirs.push(baseDir);

    const sourceDir = join(baseDir, 'knowledge-source');
    await mkdir(sourceDir, { recursive: true });
    await writeMarkdownFile(
      join(sourceDir, 'doc-a.md'),
      `---
type: runbook
services: [payments]
---
# Payments Retry Runbook

retry-strategy guidance
`
    );
    await writeMarkdownFile(
      join(sourceDir, 'doc-b.md'),
      `---
type: runbook
services: [payments]
---
# Payments Queue Runbook

retry-strategy fallback
`
    );

    await writeFile(
      join(baseDir, 'config.yaml'),
      stringifyYaml({
        knowledge: {
          sources: [
            {
              type: 'filesystem',
              path: sourceDir,
            },
          ],
          store: {
            path: join(baseDir, 'knowledge.db'),
          },
          retrieval: {
            topK: 1,
          },
        },
      }),
      'utf-8'
    );

    const retriever = await createConfiguredRetriever(baseDir);
    try {
      await retriever.sync();
      const results = await retriever.search('retry-strategy');
      const total =
        results.runbooks.length +
        results.postmortems.length +
        results.architecture.length +
        results.knownIssues.length;
      expect(total).toBe(1);
    } finally {
      retriever.close();
    }
  });
});
