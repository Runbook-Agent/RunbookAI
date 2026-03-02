/**
 * Knowledge Retriever Interface
 *
 * Defines the contract for knowledge retrieval, allowing both local
 * (SQLite-backed) and remote (HTTP API) implementations.
 */

import type { KnowledgeDocument, KnowledgeType, RetrievedKnowledge } from '../types';

export interface SearchOptions {
  typeFilter?: KnowledgeType[];
  serviceFilter?: string[];
  limit?: number;
  rerank?: boolean;
}

export interface IKnowledgeRetriever {
  sync(): Promise<{ added: number; updated: number }>;
  ensureInitialized(): Promise<void>;
  search(query: string, options?: SearchOptions): Promise<RetrievedKnowledge>;
  getDocumentCount(): number | Promise<number>;
  getDocumentCountsByType(): Record<KnowledgeType, number> | Promise<Record<KnowledgeType, number>>;
  getAllDocuments(): KnowledgeDocument[] | Promise<KnowledgeDocument[]>;
  close(): void;
}
