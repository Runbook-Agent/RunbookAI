/**
 * Datadog Integration
 *
 * Provides tools for querying Datadog metrics, logs, and APM traces.
 * Useful for incident investigation and monitoring.
 */

import { loadServiceConfig } from '../../config/onboarding';

interface DatadogConfig {
  apiKey: string;
  appKey: string;
  site: string;
}

async function getDatadogConfig(): Promise<DatadogConfig | null> {
  const config = await loadServiceConfig();

  if (!config?.observability?.datadog?.enabled) {
    return null;
  }

  const apiKey = config.observability.datadog.apiKey || process.env.DD_API_KEY;
  const appKey = config.observability.datadog.appKey || process.env.DD_APP_KEY;
  const site = config.observability.datadog.site || 'datadoghq.com';

  if (!apiKey || !appKey) {
    return null;
  }

  return { apiKey, appKey, site };
}

function getBaseUrl(site: string): string {
  return `https://api.${site}`;
}

async function datadogRequest<T>(
  config: DatadogConfig,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${getBaseUrl(config.site)}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'DD-API-KEY': config.apiKey,
      'DD-APPLICATION-KEY': config.appKey,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Datadog API error: ${response.status} - ${error}`);
  }

  return response.json() as Promise<T>;
}

// ═══════════════════════════════════════════════════════════════
// METRICS
// ═══════════════════════════════════════════════════════════════

export interface MetricQuery {
  query: string;
  from: number;
  to: number;
}

export interface MetricSeries {
  metric: string;
  displayName?: string;
  unit?: string;
  pointlist: Array<[number, number]>;
  scope?: string;
  expression?: string;
}

export interface MetricQueryResult {
  status: string;
  series: MetricSeries[];
  fromDate: number;
  toDate: number;
  query: string;
}

/**
 * Query Datadog metrics
 */
export async function queryMetrics(
  query: string,
  fromSeconds: number = 3600,
  toSeconds: number = 0
): Promise<MetricQueryResult | null> {
  const config = await getDatadogConfig();
  if (!config) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const from = now - fromSeconds;
  const to = now - toSeconds;

  const params = new URLSearchParams({
    query,
    from: from.toString(),
    to: to.toString(),
  });

  const result = await datadogRequest<{
    status: string;
    series: MetricSeries[];
    from_date: number;
    to_date: number;
    query: string;
  }>(config, `/api/v1/query?${params}`);

  return {
    status: result.status,
    series: result.series || [],
    fromDate: result.from_date,
    toDate: result.to_date,
    query: result.query,
  };
}

/**
 * Get active metrics list
 */
export async function listActiveMetrics(from?: number, host?: string): Promise<string[]> {
  const config = await getDatadogConfig();
  if (!config) {
    return [];
  }

  const now = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    from: (from || now - 3600).toString(),
  });
  if (host) {
    params.set('host', host);
  }

  const result = await datadogRequest<{ metrics: string[] }>(config, `/api/v1/metrics?${params}`);

  return result.metrics || [];
}

// ═══════════════════════════════════════════════════════════════
// LOGS
// ═══════════════════════════════════════════════════════════════

export interface LogEvent {
  id: string;
  timestamp: string;
  message: string;
  status: string;
  service?: string;
  host?: string;
  tags?: string[];
  attributes?: Record<string, unknown>;
}

export interface LogSearchResult {
  logs: LogEvent[];
  nextCursor?: string;
}

/**
 * Search Datadog logs
 */
export async function searchLogs(
  query: string,
  options: {
    from?: string;
    to?: string;
    limit?: number;
    sort?: 'asc' | 'desc';
    indexes?: string[];
  } = {}
): Promise<LogSearchResult | null> {
  const config = await getDatadogConfig();
  if (!config) {
    return null;
  }

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const body = {
    filter: {
      query,
      from: options.from || oneHourAgo.toISOString(),
      to: options.to || now.toISOString(),
      indexes: options.indexes || ['*'],
    },
    sort: options.sort === 'asc' ? 'timestamp' : '-timestamp',
    page: {
      limit: options.limit || 50,
    },
  };

  const result = await datadogRequest<{
    data: Array<{
      id: string;
      attributes: {
        timestamp: string;
        message: string;
        status: string;
        service?: string;
        host?: string;
        tags?: string[];
        attributes?: Record<string, unknown>;
      };
    }>;
    meta?: {
      page?: {
        after?: string;
      };
    };
  }>(config, '/api/v2/logs/events/search', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return {
    logs: (result.data || []).map((log) => ({
      id: log.id,
      timestamp: log.attributes.timestamp,
      message: log.attributes.message,
      status: log.attributes.status,
      service: log.attributes.service,
      host: log.attributes.host,
      tags: log.attributes.tags,
      attributes: log.attributes.attributes,
    })),
    nextCursor: result.meta?.page?.after,
  };
}

// ═══════════════════════════════════════════════════════════════
// APM / TRACES
// ═══════════════════════════════════════════════════════════════

export interface TraceSpan {
  traceId: string;
  spanId: string;
  service: string;
  resource: string;
  operation?: string;
  duration: number;
  start: number;
  error?: boolean;
  meta?: Record<string, string>;
}

export interface TraceSearchResult {
  spans: TraceSpan[];
}

/**
 * Search APM traces
 */
export async function searchTraces(
  query: string,
  options: {
    from?: number;
    to?: number;
    limit?: number;
    service?: string;
  } = {}
): Promise<TraceSearchResult | null> {
  const config = await getDatadogConfig();
  if (!config) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    query,
    start: (options.from || now - 3600).toString(),
    end: (options.to || now).toString(),
    limit: (options.limit || 50).toString(),
  });

  if (options.service) {
    params.set('service', options.service);
  }

  try {
    const result = await datadogRequest<{
      data: Array<{
        attributes: {
          trace_id: string;
          span_id: string;
          service: string;
          resource: string;
          operation_name?: string;
          duration: number;
          start: number;
          error?: number;
          meta?: Record<string, string>;
        };
      }>;
    }>(config, `/api/v2/spans/events/search?${params}`);

    return {
      spans: (result.data || []).map((span) => ({
        traceId: span.attributes.trace_id,
        spanId: span.attributes.span_id,
        service: span.attributes.service,
        resource: span.attributes.resource,
        operation: span.attributes.operation_name,
        duration: span.attributes.duration,
        start: span.attributes.start,
        error: span.attributes.error === 1,
        meta: span.attributes.meta,
      })),
    };
  } catch {
    // APM API might not be available
    return { spans: [] };
  }
}

// ═══════════════════════════════════════════════════════════════
// MONITORS / ALERTS
// ═══════════════════════════════════════════════════════════════

export interface DatadogMonitor {
  id: number;
  name: string;
  type: string;
  query: string;
  message: string;
  overallState: string;
  tags: string[];
  priority?: number;
  created: string;
  modified: string;
}

/**
 * List monitors (alerts)
 */
export async function listMonitors(
  options: {
    groupStates?: string[];
    name?: string;
    tags?: string[];
  } = {}
): Promise<DatadogMonitor[]> {
  const config = await getDatadogConfig();
  if (!config) {
    return [];
  }

  const params = new URLSearchParams();
  if (options.groupStates) {
    params.set('group_states', options.groupStates.join(','));
  }
  if (options.name) {
    params.set('name', options.name);
  }
  if (options.tags) {
    params.set('monitor_tags', options.tags.join(','));
  }

  const result = await datadogRequest<
    Array<{
      id: number;
      name: string;
      type: string;
      query: string;
      message: string;
      overall_state: string;
      tags: string[];
      priority?: number;
      created: string;
      modified: string;
    }>
  >(config, `/api/v1/monitor?${params}`);

  return (result || []).map((m) => ({
    id: m.id,
    name: m.name,
    type: m.type,
    query: m.query,
    message: m.message,
    overallState: m.overall_state,
    tags: m.tags,
    priority: m.priority,
    created: m.created,
    modified: m.modified,
  }));
}

/**
 * Get triggered monitors
 */
export async function getTriggeredMonitors(): Promise<DatadogMonitor[]> {
  return listMonitors({ groupStates: ['Alert', 'Warn', 'No Data'] });
}

// ═══════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════

export interface DatadogEvent {
  id: number;
  title: string;
  text: string;
  dateHappened: number;
  priority: string;
  host?: string;
  tags?: string[];
  alertType?: string;
  source?: string;
}

/**
 * Get recent events
 */
export async function getEvents(
  options: {
    start?: number;
    end?: number;
    priority?: 'normal' | 'low';
    tags?: string[];
    sources?: string[];
  } = {}
): Promise<DatadogEvent[]> {
  const config = await getDatadogConfig();
  if (!config) {
    return [];
  }

  const now = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    start: (options.start || now - 86400).toString(),
    end: (options.end || now).toString(),
  });

  if (options.priority) {
    params.set('priority', options.priority);
  }
  if (options.tags) {
    params.set('tags', options.tags.join(','));
  }
  if (options.sources) {
    params.set('sources', options.sources.join(','));
  }

  const result = await datadogRequest<{
    events: Array<{
      id: number;
      title: string;
      text: string;
      date_happened: number;
      priority: string;
      host?: string;
      tags?: string[];
      alert_type?: string;
      source?: string;
    }>;
  }>(config, `/api/v1/events?${params}`);

  return (result.events || []).map((e) => ({
    id: e.id,
    title: e.title,
    text: e.text,
    dateHappened: e.date_happened,
    priority: e.priority,
    host: e.host,
    tags: e.tags,
    alertType: e.alert_type,
    source: e.source,
  }));
}

// ═══════════════════════════════════════════════════════════════
// SERVICE CATALOG
// ═══════════════════════════════════════════════════════════════

export interface DatadogService {
  name: string;
  type?: string;
  languages?: string[];
  env?: string[];
  team?: string;
  contacts?: Array<{ type: string; contact: string }>;
}

/**
 * List services from service catalog
 */
export async function listServices(): Promise<DatadogService[]> {
  const config = await getDatadogConfig();
  if (!config) {
    return [];
  }

  try {
    const result = await datadogRequest<{
      data: Array<{
        attributes: {
          schema: {
            'dd-service': string;
            'dd-team'?: string;
            contacts?: Array<{ type: string; contact: string }>;
            languages?: string[];
            type?: string;
          };
        };
      }>;
    }>(config, '/api/v2/services/definitions');

    return (result.data || []).map((s) => ({
      name: s.attributes.schema['dd-service'],
      type: s.attributes.schema.type,
      languages: s.attributes.schema.languages,
      team: s.attributes.schema['dd-team'],
      contacts: s.attributes.schema.contacts,
    }));
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Check if Datadog is configured
 */
export async function isDatadogConfigured(): Promise<boolean> {
  const config = await getDatadogConfig();
  return config !== null;
}

/**
 * Get a summary of Datadog status
 */
export async function getDatadogSummary(): Promise<{
  configured: boolean;
  triggeredMonitors: number;
  recentEvents: number;
  services: number;
} | null> {
  const config = await getDatadogConfig();
  if (!config) {
    return null;
  }

  try {
    const [monitors, events, services] = await Promise.all([
      getTriggeredMonitors(),
      getEvents({ start: Math.floor(Date.now() / 1000) - 3600 }),
      listServices(),
    ]);

    return {
      configured: true,
      triggeredMonitors: monitors.length,
      recentEvents: events.length,
      services: services.length,
    };
  } catch {
    return {
      configured: true,
      triggeredMonitors: 0,
      recentEvents: 0,
      services: 0,
    };
  }
}
