/**
 * Infrastructure Context
 *
 * Pre-scans available AWS resources, health summaries, and recent deployments
 * to provide infrastructure awareness before investigation begins.
 */

/**
 * Lightweight resource summary.
 */
export interface ResourceSummary {
  id: string;
  name: string;
  type: string;
  region: string;
  status?: string;
  tags?: Record<string, string>;
}

/**
 * Service-specific inventory counts.
 */
export interface ServiceInventory {
  serviceId: string;
  count: number;
  healthy: number;
  unhealthy: number;
  regions: string[];
  lastUpdated: string;
}

/**
 * Overall health summary.
 */
export interface HealthSummary {
  overall: 'healthy' | 'degraded' | 'critical' | 'unknown';
  healthy: number;
  warning: number;
  critical: number;
  alarmsActive: number;
  lastChecked: string;
}

/**
 * Recent deployment information.
 */
export interface DeploymentInfo {
  service: string;
  type: 'ecs' | 'lambda' | 'amplify' | 'ec2' | 'unknown';
  status: 'success' | 'failed' | 'in_progress' | 'rollback';
  deployedAt: string;
  version?: string;
  region: string;
}

/**
 * Full infrastructure context.
 */
export interface InfrastructureContext {
  /** Lightweight inventory per service */
  inventory: Map<string, ServiceInventory>;
  /** Overall health summary */
  healthSummary: HealthSummary;
  /** Recent deployments (last 24h) */
  recentDeployments: DeploymentInfo[];
  /** Active alarms */
  activeAlarms: AlarmInfo[];
  /** Quick access to key services */
  keyServices: ResourceSummary[];
  /** Last discovery time */
  discoveredAt: string;
  /** Discovery duration in ms */
  discoveryDuration: number;
  /** Whether discovery is still in progress */
  isDiscovering: boolean;
}

/**
 * CloudWatch alarm information.
 */
export interface AlarmInfo {
  name: string;
  state: 'ALARM' | 'OK' | 'INSUFFICIENT_DATA';
  service?: string;
  region: string;
  lastStateChange?: string;
}

/**
 * Configuration for infrastructure discovery.
 */
export interface InfraDiscoveryConfig {
  /** AWS regions to scan */
  regions: string[];
  /** Default region if none specified */
  defaultRegion: string;
  /** Services to include in discovery */
  services: string[];
  /** Cache TTL in ms */
  cacheTtl: number;
  /** Max concurrent API calls */
  maxConcurrency: number;
  /** Timeout per service query in ms */
  timeoutPerService: number;
}

const DEFAULT_CONFIG: InfraDiscoveryConfig = {
  regions: ['us-east-1'],
  defaultRegion: 'us-east-1',
  services: ['ec2', 'ecs', 'lambda', 'rds', 's3', 'dynamodb', 'elasticache', 'sqs', 'sns'],
  cacheTtl: 5 * 60 * 1000, // 5 minutes
  maxConcurrency: 5,
  timeoutPerService: 10000, // 10 seconds
};

/**
 * InfraContextManager handles infrastructure discovery and caching.
 */
export class InfraContextManager {
  private readonly config: InfraDiscoveryConfig;
  private context: InfrastructureContext;
  private lastDiscoveryTime: number = 0;
  private discoveryPromise: Promise<void> | null = null;

  constructor(config: Partial<InfraDiscoveryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.context = this.createEmptyContext();
  }

  /**
   * Create an empty context structure.
   */
  private createEmptyContext(): InfrastructureContext {
    return {
      inventory: new Map(),
      healthSummary: {
        overall: 'unknown',
        healthy: 0,
        warning: 0,
        critical: 0,
        alarmsActive: 0,
        lastChecked: '',
      },
      recentDeployments: [],
      activeAlarms: [],
      keyServices: [],
      discoveredAt: '',
      discoveryDuration: 0,
      isDiscovering: false,
    };
  }

  /**
   * Run infrastructure discovery.
   */
  async discover(): Promise<InfrastructureContext> {
    // Check cache
    const now = Date.now();
    if (now - this.lastDiscoveryTime < this.config.cacheTtl) {
      return this.context;
    }

    // If discovery is already in progress, wait for it
    if (this.discoveryPromise) {
      await this.discoveryPromise;
      return this.context;
    }

    // Start discovery
    const startTime = Date.now();
    this.context.isDiscovering = true;

    this.discoveryPromise = this.runDiscovery();

    try {
      await this.discoveryPromise;
    } finally {
      this.discoveryPromise = null;
      this.context.isDiscovering = false;
    }

    this.context.discoveredAt = new Date().toISOString();
    this.context.discoveryDuration = Date.now() - startTime;
    this.lastDiscoveryTime = now;

    return this.context;
  }

  /**
   * Internal discovery implementation.
   */
  private async runDiscovery(): Promise<void> {
    // Discover inventory
    await this.discoverInventory();

    // Discover alarms
    await this.discoverAlarms();

    // Discover recent deployments
    await this.discoverDeployments();

    // Calculate health summary
    this.calculateHealthSummary();

    // Identify key services
    this.identifyKeyServices();
  }

  /**
   * Discover resource inventory.
   */
  private async discoverInventory(): Promise<void> {
    const { executeMultiServiceQuery, getInstalledServices } =
      await import('../providers/aws/executor');
    const { getServiceById, AWS_SERVICES } = await import('../providers/aws/services');

    // Get services to query
    const servicesToQuery = this.config.services
      .map((id) => getServiceById(id))
      .filter((s): s is NonNullable<typeof s> => s !== undefined);

    // Filter to installed services only
    const installedServices = await getInstalledServices(servicesToQuery);

    for (const region of this.config.regions) {
      try {
        const results = await executeMultiServiceQuery(installedServices, {
          region,
          limit: 50,
        });

        for (const [serviceId, result] of Object.entries(results)) {
          if (result.error) continue;

          const existing = this.context.inventory.get(serviceId);
          const healthyCount = this.countHealthy(serviceId, result.resources);
          const unhealthyCount = result.count - healthyCount;

          if (existing) {
            existing.count += result.count;
            existing.healthy += healthyCount;
            existing.unhealthy += unhealthyCount;
            if (!existing.regions.includes(region)) {
              existing.regions.push(region);
            }
          } else {
            this.context.inventory.set(serviceId, {
              serviceId,
              count: result.count,
              healthy: healthyCount,
              unhealthy: unhealthyCount,
              regions: [region],
              lastUpdated: new Date().toISOString(),
            });
          }
        }
      } catch (error) {
        // Log but continue with other regions
        console.error(`Discovery failed for region ${region}:`, error);
      }
    }
  }

  /**
   * Count healthy resources for a service.
   */
  private countHealthy(serviceId: string, resources: unknown[]): number {
    let healthy = 0;

    for (const resource of resources) {
      if (!resource || typeof resource !== 'object') continue;
      const r = resource as Record<string, unknown>;

      switch (serviceId) {
        case 'ec2':
          if (r.state === 'running') healthy++;
          break;
        case 'ecs':
          if (r.status === 'ACTIVE' || r.runningCount === r.desiredCount) healthy++;
          break;
        case 'lambda':
          if (r.state === 'Active') healthy++;
          break;
        case 'rds':
          if (r.status === 'available') healthy++;
          break;
        default:
          // Assume healthy if no status field
          healthy++;
      }
    }

    return healthy;
  }

  /**
   * Discover active CloudWatch alarms.
   */
  private async discoverAlarms(): Promise<void> {
    try {
      const { getActiveAlarms } = await import('../tools/aws/cloudwatch');

      for (const region of this.config.regions) {
        const alarms = await getActiveAlarms(region);

        for (const alarm of alarms) {
          if (alarm.stateValue === 'ALARM') {
            const alarmRecord = alarm as unknown as Record<string, unknown>;
            this.context.activeAlarms.push({
              name: alarm.alarmName,
              state: alarm.stateValue as 'ALARM' | 'OK' | 'INSUFFICIENT_DATA',
              service: this.extractServiceFromAlarm(alarmRecord),
              region,
              lastStateChange: (alarmRecord.stateUpdatedTimestamp ||
                alarmRecord.StateUpdatedTimestamp) as string | undefined,
            });
          }
        }
      }
    } catch (error) {
      // Alarms are optional
      console.error('Failed to discover alarms:', error);
    }
  }

  /**
   * Extract service name from alarm.
   */
  private extractServiceFromAlarm(alarm: Record<string, unknown>): string | undefined {
    const name = (alarm.alarmName as string) || '';
    const dimensions = (alarm.dimensions as Array<{ Name: string; Value: string }>) || [];

    // Check dimensions for service hints
    for (const dim of dimensions) {
      if (dim.Name === 'ServiceName' || dim.Name === 'FunctionName' || dim.Name === 'ClusterName') {
        return dim.Value;
      }
    }

    // Try to extract from alarm name
    const patterns = [
      /^([a-zA-Z0-9_-]+)-(alarm|alert|monitor)/i,
      /-(service|function|cluster|instance)/i,
    ];

    for (const pattern of patterns) {
      const match = name.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return undefined;
  }

  /**
   * Discover recent deployments.
   */
  private async discoverDeployments(): Promise<void> {
    // This would ideally query Amplify, CodeDeploy, ECS deployments, etc.
    // For now, check ECS service events for deployment indicators

    const ecsInventory = this.context.inventory.get('ecs');
    if (!ecsInventory || ecsInventory.count === 0) {
      return;
    }

    // In a real implementation, we'd query ECS DescribeServices for recent deployments
    // For now, this is a placeholder that would be filled in during integration
  }

  /**
   * Calculate overall health summary.
   */
  private calculateHealthSummary(): void {
    let healthy = 0;
    let warning = 0;
    let critical = 0;

    for (const inv of this.context.inventory.values()) {
      healthy += inv.healthy;
      if (inv.unhealthy > 0) {
        if (inv.unhealthy > inv.healthy) {
          critical += inv.unhealthy;
        } else {
          warning += inv.unhealthy;
        }
      }
    }

    const alarmsActive = this.context.activeAlarms.length;

    let overall: 'healthy' | 'degraded' | 'critical' | 'unknown' = 'unknown';
    if (healthy + warning + critical === 0) {
      overall = 'unknown';
    } else if (critical > 0 || alarmsActive > 2) {
      overall = 'critical';
    } else if (warning > 0 || alarmsActive > 0) {
      overall = 'degraded';
    } else {
      overall = 'healthy';
    }

    this.context.healthSummary = {
      overall,
      healthy,
      warning,
      critical,
      alarmsActive,
      lastChecked: new Date().toISOString(),
    };
  }

  /**
   * Identify key services for quick access.
   */
  private identifyKeyServices(): void {
    // Key services are services with high resource counts or active issues
    const keyServices: ResourceSummary[] = [];

    for (const [serviceId, inv] of this.context.inventory) {
      if (inv.count >= 5 || inv.unhealthy > 0) {
        keyServices.push({
          id: serviceId,
          name: serviceId.toUpperCase(),
          type: 'aws_service',
          region: inv.regions[0] || this.config.defaultRegion,
          status: inv.unhealthy > 0 ? 'degraded' : 'healthy',
        });
      }
    }

    this.context.keyServices = keyServices;
  }

  /**
   * Get the current context.
   */
  getContext(): Readonly<InfrastructureContext> {
    return this.context;
  }

  /**
   * Check if discovery has been run.
   */
  hasDiscovered(): boolean {
    return this.context.discoveredAt !== '';
  }

  /**
   * Check if cache is stale.
   */
  isCacheStale(): boolean {
    return Date.now() - this.lastDiscoveryTime >= this.config.cacheTtl;
  }

  /**
   * Build the infrastructure overview section for system prompt.
   */
  buildOverviewSection(): string {
    if (!this.hasDiscovered()) {
      return '## Infrastructure\n\nInfrastructure discovery not yet run.';
    }

    const sections: string[] = [];
    sections.push('## Infrastructure Overview\n');

    // Health summary
    const { healthSummary } = this.context;
    const healthEmoji =
      healthSummary.overall === 'healthy' ? '✓' : healthSummary.overall === 'degraded' ? '!' : '✗';
    sections.push(`**Status:** ${healthEmoji} ${healthSummary.overall.toUpperCase()}`);
    sections.push(
      `Resources: ${healthSummary.healthy} healthy, ${healthSummary.warning} warning, ${healthSummary.critical} critical`
    );

    if (healthSummary.alarmsActive > 0) {
      sections.push(`Active alarms: ${healthSummary.alarmsActive}`);
    }

    // Service inventory
    if (this.context.inventory.size > 0) {
      sections.push('\n**Service Inventory:**');
      const sorted = Array.from(this.context.inventory.entries()).sort(
        (a, b) => b[1].count - a[1].count
      );

      for (const [serviceId, inv] of sorted.slice(0, 8)) {
        const status = inv.unhealthy > 0 ? ` (${inv.unhealthy} unhealthy)` : '';
        sections.push(`- ${serviceId}: ${inv.count} resource(s)${status}`);
      }
    }

    // Active alarms
    if (this.context.activeAlarms.length > 0) {
      sections.push('\n**Active Alarms:**');
      for (const alarm of this.context.activeAlarms.slice(0, 5)) {
        sections.push(`- ${alarm.name}${alarm.service ? ` (${alarm.service})` : ''}`);
      }
    }

    // Recent deployments
    if (this.context.recentDeployments.length > 0) {
      sections.push('\n**Recent Deployments:**');
      for (const deploy of this.context.recentDeployments.slice(0, 3)) {
        const status = deploy.status === 'success' ? '✓' : deploy.status === 'failed' ? '✗' : '...';
        sections.push(`- ${deploy.service}: ${status} ${deploy.deployedAt}`);
      }
    }

    return sections.join('\n');
  }

  /**
   * Build compact summary for iteration prompts.
   */
  buildCompactSummary(): string {
    if (!this.hasDiscovered()) {
      return 'Infrastructure: not discovered';
    }

    const { healthSummary, inventory, activeAlarms } = this.context;
    const parts: string[] = [];

    parts.push(`Status: ${healthSummary.overall}`);

    let totalResources = 0;
    for (const inv of inventory.values()) {
      totalResources += inv.count;
    }
    parts.push(`${totalResources} resources across ${inventory.size} services`);

    if (activeAlarms.length > 0) {
      parts.push(`${activeAlarms.length} active alarm(s)`);
    }

    return parts.join(', ');
  }

  /**
   * Get services with issues.
   */
  getServicesWithIssues(): string[] {
    const issues: string[] = [];

    for (const [serviceId, inv] of this.context.inventory) {
      if (inv.unhealthy > 0) {
        issues.push(serviceId);
      }
    }

    // Add services with active alarms
    for (const alarm of this.context.activeAlarms) {
      if (alarm.service && !issues.includes(alarm.service)) {
        issues.push(alarm.service);
      }
    }

    return issues;
  }

  /**
   * Get resource count for a service.
   */
  getServiceResourceCount(serviceId: string): number {
    return this.context.inventory.get(serviceId)?.count || 0;
  }

  /**
   * Check if a service has resources.
   */
  hasService(serviceId: string): boolean {
    const inv = this.context.inventory.get(serviceId);
    return inv !== undefined && inv.count > 0;
  }

  /**
   * Reset context.
   */
  reset(): void {
    this.context = this.createEmptyContext();
    this.lastDiscoveryTime = 0;
  }

  /**
   * Force refresh (ignore cache).
   */
  async forceRefresh(): Promise<InfrastructureContext> {
    this.lastDiscoveryTime = 0;
    return this.discover();
  }
}

/**
 * Create a default infrastructure context manager.
 */
export function createInfraContextManager(
  config?: Partial<InfraDiscoveryConfig>
): InfraContextManager {
  return new InfraContextManager(config);
}
