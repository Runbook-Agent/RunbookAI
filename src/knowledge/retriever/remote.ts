/**
 * Remote Knowledge Retriever
 *
 * Implements IKnowledgeRetriever by making HTTP calls to a shared
 * RunbookAI server. Used when config.server.url is set.
 */

import type { KnowledgeDocument, KnowledgeType, RetrievedKnowledge } from '../types';
import type { IKnowledgeRetriever, SearchOptions } from './types';

interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
  meta?: { durationMs: number };
}

export class RemoteKnowledgeRetriever implements IKnowledgeRetriever {
  private baseUrl: string;
  private apiKey: string;

  constructor(serverUrl: string, apiKey: string) {
    this.baseUrl = serverUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let errorMessage = `HTTP ${res.status}`;
      try {
        const errorBody = (await res.json()) as ApiResponse<unknown>;
        if (errorBody.error) {
          errorMessage = `${errorBody.error.code}: ${errorBody.error.message}`;
        }
      } catch {
        // Use status text if body parsing fails
        errorMessage = `HTTP ${res.status} ${res.statusText}`;
      }
      throw new Error(`Remote server error: ${errorMessage}`);
    }

    const json = (await res.json()) as ApiResponse<T>;
    if (json.error) {
      throw new Error(`Remote server error: ${json.error.code}: ${json.error.message}`);
    }
    return json.data as T;
  }

  async sync(): Promise<{ added: number; updated: number }> {
    return this.request<{ added: number; updated: number }>('POST', '/api/v1/knowledge/sync');
  }

  async ensureInitialized(): Promise<void> {
    // Server manages its own initialization
  }

  async search(query: string, options: SearchOptions = {}): Promise<RetrievedKnowledge> {
    return this.request<RetrievedKnowledge>('POST', '/api/v1/knowledge/search', {
      query,
      ...options,
    });
  }

  async getDocumentCount(): Promise<number> {
    const stats = await this.request<Record<KnowledgeType, number>>(
      'GET',
      '/api/v1/knowledge/stats'
    );
    return Object.values(stats).reduce((sum, c) => sum + c, 0);
  }

  async getDocumentCountsByType(): Promise<Record<KnowledgeType, number>> {
    return this.request<Record<KnowledgeType, number>>('GET', '/api/v1/knowledge/stats');
  }

  async getAllDocuments(): Promise<KnowledgeDocument[]> {
    return this.request<KnowledgeDocument[]>('GET', '/api/v1/knowledge/documents');
  }

  close(): void {
    // No-op for remote retriever
  }
}
