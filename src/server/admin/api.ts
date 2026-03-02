export interface HealthData {
  status: string;
  version: string;
  uptime: number;
}

export interface KnowledgeDocument {
  id: string;
  type: string;
  title: string;
  content: string;
  services: string[];
  tags: string[];
  chunks: unknown[];
  createdAt: string;
  updatedAt: string;
  author?: string;
  sourceUrl?: string;
}

export interface RetrievedChunk {
  id: string;
  documentId: string;
  title: string;
  content: string;
  type: string;
  services: string[];
  score: number;
  sourceUrl?: string;
}

export interface RetrievedKnowledge {
  runbooks: RetrievedChunk[];
  postmortems: RetrievedChunk[];
  architecture: RetrievedChunk[];
  knownIssues: RetrievedChunk[];
}

export interface SourceInfo {
  type: string;
  path?: string;
  repo?: string;
  branch?: string;
  baseUrl?: string;
  spaceKey?: string;
  endpoint?: string;
  databaseId?: string;
  authConfigured: boolean;
}

export class AdminApi {
  constructor(private apiKey: string) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error?.message || `Request failed: ${res.status}`);
    }
    return json.data as T;
  }

  getHealth(): Promise<HealthData> {
    return this.request('GET', '/api/v1/health');
  }

  getStats(): Promise<Record<string, number>> {
    return this.request('GET', '/api/v1/knowledge/stats');
  }

  getDocuments(type?: string): Promise<KnowledgeDocument[]> {
    const params = type ? `?type=${encodeURIComponent(type)}` : '';
    return this.request('GET', `/api/v1/knowledge/documents${params}`);
  }

  getDocument(id: string): Promise<KnowledgeDocument> {
    return this.request('GET', `/api/v1/knowledge/documents/${encodeURIComponent(id)}`);
  }

  updateDocument(id: string, doc: Partial<KnowledgeDocument>): Promise<KnowledgeDocument> {
    return this.request('PUT', `/api/v1/knowledge/documents/${encodeURIComponent(id)}`, doc);
  }

  deleteDocument(id: string): Promise<{ deleted: boolean }> {
    return this.request('DELETE', `/api/v1/knowledge/documents/${encodeURIComponent(id)}`);
  }

  search(
    query: string,
    options?: { typeFilter?: string[]; serviceFilter?: string[] }
  ): Promise<RetrievedKnowledge> {
    return this.request('POST', '/api/v1/knowledge/search', { query, ...options });
  }

  getServices(type?: string): Promise<string[]> {
    const params = type ? `?type=${encodeURIComponent(type)}` : '';
    return this.request('GET', `/api/v1/knowledge/services${params}`);
  }

  getSources(): Promise<SourceInfo[]> {
    return this.request('GET', '/api/v1/knowledge/sources');
  }

  sync(): Promise<{ added: number; updated: number }> {
    return this.request('POST', '/api/v1/knowledge/sync');
  }
}
