/**
 * Change Intelligence Adapter — HTTP client for the Change Intelligence Service
 *
 * Follows the pattern from src/providers/operability-context/adapters/http.ts.
 * Types are inlined to avoid shared-package dependency.
 */

// --- Inlined types (minimal subset of service types) ---

export interface ChangeEvent {
  id: string;
  timestamp: string;
  service: string;
  additionalServices: string[];
  changeType: string;
  source: string;
  initiator: string;
  initiatorIdentity?: string;
  status: string;
  environment: string;
  commitSha?: string;
  prNumber?: string;
  prUrl?: string;
  repository?: string;
  branch?: string;
  summary: string;
  diff?: string;
  filesChanged?: string[];
  configKeys?: string[];
  previousVersion?: string;
  newVersion?: string;
  blastRadius?: BlastRadiusPrediction;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface BlastRadiusPrediction {
  directServices: string[];
  downstreamServices: string[];
  criticalPathAffected: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  impactPaths: { from: string; to: string; hops: number; criticality: string; path: string[] }[];
  rationale: string[];
}

export interface ChangeCorrelation {
  changeEvent: ChangeEvent;
  correlationScore: number;
  correlationReasons: string[];
  serviceOverlap: string[];
  timeDeltaMinutes: number;
}

export interface ChangeVelocityMetric {
  service: string;
  windowStart: string;
  windowEnd: string;
  changeCount: number;
  changeTypes: Record<string, number>;
  averageIntervalMinutes: number;
}

export interface ChangeQueryOptions {
  services?: string[];
  changeTypes?: string[];
  sources?: string[];
  environment?: string;
  since?: string;
  until?: string;
  initiator?: string;
  status?: string;
  query?: string;
  limit?: number;
}

// --- Adapter ---

export interface ChangeIntelligenceConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}

export class ChangeIntelligenceAdapter {
  private baseUrl: string;
  private apiKey?: string;
  private timeoutMs: number;

  constructor(config: ChangeIntelligenceConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs || 5000;
  }

  async queryEvents(options: ChangeQueryOptions = {}): Promise<ChangeEvent[]> {
    const params = new URLSearchParams();
    if (options.services?.length) params.set('services', options.services.join(','));
    if (options.changeTypes?.length) params.set('change_types', options.changeTypes.join(','));
    if (options.sources?.length) params.set('sources', options.sources.join(','));
    if (options.environment) params.set('environment', options.environment);
    if (options.since) params.set('since', options.since);
    if (options.until) params.set('until', options.until);
    if (options.initiator) params.set('initiator', options.initiator);
    if (options.status) params.set('status', options.status);
    if (options.query) params.set('q', options.query);
    if (options.limit) params.set('limit', String(options.limit));

    const qs = params.toString();
    const path = `/api/v1/events${qs ? `?${qs}` : ''}`;
    return this.request<ChangeEvent[]>('GET', path);
  }

  async correlateWithIncident(
    affectedServices: string[],
    incidentTime?: string,
    windowMinutes?: number
  ): Promise<{ correlations: ChangeCorrelation[] }> {
    return this.request<{ correlations: ChangeCorrelation[] }>('POST', '/api/v1/correlate', {
      affected_services: affectedServices,
      incident_time: incidentTime,
      window_minutes: windowMinutes,
    });
  }

  async predictBlastRadius(
    services: string[],
    changeType?: string
  ): Promise<BlastRadiusPrediction> {
    return this.request<BlastRadiusPrediction>('POST', '/api/v1/blast-radius', {
      services,
      change_type: changeType,
    });
  }

  async getVelocity(
    service: string,
    windowMinutes?: number,
    periods?: number
  ): Promise<ChangeVelocityMetric | { trend: ChangeVelocityMetric[] }> {
    const params = new URLSearchParams();
    if (windowMinutes) params.set('window_minutes', String(windowMinutes));
    if (periods) params.set('periods', String(periods));
    const qs = params.toString();
    return this.request(
      'GET',
      `/api/v1/velocity/${encodeURIComponent(service)}${qs ? `?${qs}` : ''}`
    );
  }

  async registerEvent(
    event: Partial<ChangeEvent> & { service: string; changeType: string; summary: string }
  ): Promise<ChangeEvent> {
    return this.request<ChangeEvent>('POST', '/api/v1/events', event);
  }

  async healthcheck(): Promise<{ status: string }> {
    try {
      return await this.request<{ status: string }>('GET', '/api/v1/health');
    } catch {
      return { status: 'unavailable' };
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    if (method === 'POST' || method === 'PATCH') {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text().catch(() => '');
      let payload: unknown = null;
      if (text.trim()) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { message: text };
        }
      }

      if (!response.ok) {
        const msg =
          payload && typeof payload === 'object'
            ? (payload as Record<string, unknown>).error ||
              (payload as Record<string, unknown>).message
            : '';
        throw new Error(
          `Change Intelligence request failed (${response.status}): ${msg || response.statusText}`
        );
      }

      return payload as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Factory: returns adapter or null if disabled
 */
export function createChangeIntelligenceAdapter(
  config: ChangeIntelligenceConfig
): ChangeIntelligenceAdapter | null {
  if (!config.enabled) return null;
  return new ChangeIntelligenceAdapter(config);
}
