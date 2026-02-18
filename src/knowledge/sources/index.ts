/**
 * Knowledge Source Dispatcher
 *
 * Unified entry point for loading knowledge documents from various sources.
 */

import { loadFromFilesystem } from './filesystem';
import { loadFromConfluence } from './confluence';
import { loadFromGoogleDrive } from './google-drive';
import { loadFromApi } from './api';
import { loadFromNotion } from './notion';
import { loadFromGitHub } from './github';
import type { KnowledgeDocument, KnowledgeSourceConfig } from '../types';

export interface LoadOptions {
  since?: string;
}

/**
 * Load knowledge documents from a configured source
 */
export async function loadFromSource(
  config: KnowledgeSourceConfig,
  options: LoadOptions = {}
): Promise<KnowledgeDocument[]> {
  switch (config.type) {
    case 'filesystem':
      return loadFromFilesystem(config);

    case 'confluence':
      return loadFromConfluence(config, options);

    case 'google_drive':
      return loadFromGoogleDrive(config, options);

    case 'notion':
      return loadFromNotion(config, options);

    case 'github':
      return loadFromGitHub(config, options);

    case 'api':
      return loadFromApi(config, options);

    default:
      console.warn(`Unknown source type: ${(config as { type: string }).type}`);
      return [];
  }
}

export { loadFromFilesystem } from './filesystem';
export { loadFromConfluence } from './confluence';
export { loadFromGoogleDrive } from './google-drive';
export { loadFromApi } from './api';
export { loadFromNotion } from './notion';
export { loadFromGitHub } from './github';
