/**
 * OpsGenie Tools
 *
 * Provides integration with OpsGenie for incident management.
 */

const OPSGENIE_API_BASE = 'https://api.opsgenie.com/v2';

interface OpsGenieConfig {
  apiKey: string;
}

let config: OpsGenieConfig | null = null;

export function configure(apiKey: string): void {
  config = { apiKey };
}

function getApiKey(): string {
  if (config?.apiKey) return config.apiKey;
  if (process.env.OPSGENIE_API_KEY) return process.env.OPSGENIE_API_KEY;
  throw new Error('OpsGenie API key not configured. Set OPSGENIE_API_KEY environment variable.');
}

export function isOpsGenieConfigured(): boolean {
  return !!(config?.apiKey || process.env.OPSGENIE_API_KEY);
}

async function ogFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const apiKey = getApiKey();

  const response = await fetch(`${OPSGENIE_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `GenieKey ${apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpsGenie API error: ${response.status} ${error}`);
  }

  return response.json() as Promise<T>;
}

export interface OpsGenieAlert {
  id: string;
  tinyId: string;
  message: string;
  status: 'open' | 'closed' | 'acked';
  acknowledged: boolean;
  isSeen: boolean;
  priority: 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
  createdAt: string;
  updatedAt: string;
  source: string;
  tags: string[];
  teams: Array<{ id: string; name: string }>;
  responders: Array<{ type: string; id: string; name?: string }>;
  integration?: {
    id: string;
    name: string;
    type: string;
  };
  details?: Record<string, string>;
  description?: string;
}

export interface OpsGenieIncident {
  id: string;
  tinyId: string;
  message: string;
  status: 'open' | 'resolved';
  priority: 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
  createdAt: string;
  updatedAt: string;
  impactedServices: string[];
  tags: string[];
  extraProperties?: Record<string, string>;
}

/**
 * Get alert by ID
 */
export async function getAlert(alertId: string): Promise<OpsGenieAlert> {
  const response = await ogFetch<{ data: Record<string, unknown> }>(`/alerts/${alertId}`);
  return mapAlert(response.data);
}

/**
 * List alerts with optional filters
 */
export async function listAlerts(options: {
  query?: string;
  status?: 'open' | 'closed' | 'acked';
  limit?: number;
  order?: 'asc' | 'desc';
} = {}): Promise<OpsGenieAlert[]> {
  const params = new URLSearchParams();

  if (options.query) params.set('query', options.query);
  if (options.status) params.set('query', `status=${options.status}`);
  if (options.limit) params.set('limit', options.limit.toString());
  if (options.order) params.set('order', options.order);

  const response = await ogFetch<{ data: Array<Record<string, unknown>> }>(
    `/alerts?${params.toString()}`
  );

  return response.data.map(mapAlert);
}

/**
 * Get open alerts
 */
export async function getOpenAlerts(): Promise<OpsGenieAlert[]> {
  return listAlerts({ status: 'open', limit: 50 });
}

/**
 * Get incident by ID
 */
export async function getIncident(incidentId: string): Promise<OpsGenieIncident> {
  const response = await ogFetch<{ data: Record<string, unknown> }>(`/incidents/${incidentId}`);
  return mapIncident(response.data);
}

/**
 * List incidents with optional filters
 */
export async function listIncidents(options: {
  query?: string;
  status?: 'open' | 'resolved';
  limit?: number;
  order?: 'asc' | 'desc';
} = {}): Promise<OpsGenieIncident[]> {
  const params = new URLSearchParams();

  if (options.query) params.set('query', options.query);
  if (options.status) params.set('query', `status=${options.status}`);
  if (options.limit) params.set('limit', options.limit.toString());
  if (options.order) params.set('order', options.order);

  const response = await ogFetch<{ data: Array<Record<string, unknown>> }>(
    `/incidents?${params.toString()}`
  );

  return response.data.map(mapIncident);
}

/**
 * Acknowledge an alert
 */
export async function acknowledgeAlert(
  alertId: string,
  note?: string
): Promise<{ requestId: string }> {
  const response = await ogFetch<{ requestId: string }>(`/alerts/${alertId}/acknowledge`, {
    method: 'POST',
    body: JSON.stringify({
      note,
    }),
  });

  return response;
}

/**
 * Close an alert
 */
export async function closeAlert(
  alertId: string,
  note?: string
): Promise<{ requestId: string }> {
  const response = await ogFetch<{ requestId: string }>(`/alerts/${alertId}/close`, {
    method: 'POST',
    body: JSON.stringify({
      note,
    }),
  });

  return response;
}

/**
 * Add note to alert
 */
export async function addAlertNote(
  alertId: string,
  note: string
): Promise<{ requestId: string }> {
  const response = await ogFetch<{ requestId: string }>(`/alerts/${alertId}/notes`, {
    method: 'POST',
    body: JSON.stringify({
      note,
    }),
  });

  return response;
}

/**
 * Get alert notes
 */
export async function getAlertNotes(alertId: string): Promise<Array<{
  id: string;
  note: string;
  createdAt: string;
  owner: string;
}>> {
  const response = await ogFetch<{ data: Array<Record<string, unknown>> }>(
    `/alerts/${alertId}/notes`
  );

  return response.data.map((n) => ({
    id: n.id as string,
    note: n.note as string,
    createdAt: n.createdAt as string,
    owner: n.owner as string,
  }));
}

/**
 * Resolve an incident
 */
export async function resolveIncident(
  incidentId: string,
  note?: string
): Promise<{ requestId: string }> {
  const response = await ogFetch<{ requestId: string }>(`/incidents/${incidentId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({
      note,
    }),
  });

  return response;
}

/**
 * Add note to incident
 */
export async function addIncidentNote(
  incidentId: string,
  note: string
): Promise<{ requestId: string }> {
  const response = await ogFetch<{ requestId: string }>(`/incidents/${incidentId}/notes`, {
    method: 'POST',
    body: JSON.stringify({
      note,
    }),
  });

  return response;
}

/**
 * Get incident timeline
 */
export async function getIncidentTimeline(incidentId: string): Promise<Array<{
  id: string;
  type: string;
  description: string;
  createdAt: string;
}>> {
  const response = await ogFetch<{ data: Array<Record<string, unknown>> }>(
    `/incidents/${incidentId}/timeline`
  );

  return response.data.map((e) => ({
    id: e.id as string,
    type: e.type as string,
    description: (e.description as string) || (e.type as string),
    createdAt: e.createdAt as string,
  }));
}

// Helper functions
function mapAlert(data: Record<string, unknown>): OpsGenieAlert {
  return {
    id: data.id as string,
    tinyId: data.tinyId as string,
    message: data.message as string,
    status: data.status as 'open' | 'closed' | 'acked',
    acknowledged: data.acknowledged as boolean,
    isSeen: data.isSeen as boolean,
    priority: data.priority as 'P1' | 'P2' | 'P3' | 'P4' | 'P5',
    createdAt: data.createdAt as string,
    updatedAt: data.updatedAt as string,
    source: data.source as string,
    tags: (data.tags as string[]) || [],
    teams: ((data.teams as Array<Record<string, unknown>>) || []).map((t) => ({
      id: t.id as string,
      name: t.name as string,
    })),
    responders: ((data.responders as Array<Record<string, unknown>>) || []).map((r) => ({
      type: r.type as string,
      id: r.id as string,
      name: r.name as string | undefined,
    })),
    integration: data.integration
      ? {
          id: (data.integration as Record<string, unknown>).id as string,
          name: (data.integration as Record<string, unknown>).name as string,
          type: (data.integration as Record<string, unknown>).type as string,
        }
      : undefined,
    details: data.details as Record<string, string> | undefined,
    description: data.description as string | undefined,
  };
}

function mapIncident(data: Record<string, unknown>): OpsGenieIncident {
  return {
    id: data.id as string,
    tinyId: data.tinyId as string,
    message: data.message as string,
    status: data.status as 'open' | 'resolved',
    priority: data.priority as 'P1' | 'P2' | 'P3' | 'P4' | 'P5',
    createdAt: data.createdAt as string,
    updatedAt: data.updatedAt as string,
    impactedServices: (data.impactedServices as string[]) || [],
    tags: (data.tags as string[]) || [],
    extraProperties: data.extraProperties as Record<string, string> | undefined,
  };
}
