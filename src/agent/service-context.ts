/**
 * Service Context
 *
 * Integrates with ServiceGraph to auto-include upstream/downstream
 * context during investigations based on service dependencies.
 */

import type { ServiceGraph, ServiceNode, ImpactPath, DependencyEdge } from '../knowledge/store/graph-store';
import type { RetrievedChunk, ServiceOwnership } from '../knowledge/types';
import type { KnowledgeContextManager } from './knowledge-context';

/**
 * Aggregated context for a service under investigation.
 */
export interface ServiceContext {
  /** The primary service being investigated */
  service: ServiceNode;
  /** Team ownership information */
  ownership?: ServiceOwnership;
  /** Services this one depends on (upstream) */
  dependencies: ServiceNode[];
  /** Services that depend on this one (downstream) */
  dependents: ServiceNode[];
  /** Critical path dependencies (must be healthy for this service to work) */
  criticalDependencies: ServiceNode[];
  /** Potential root cause candidates (upstream issues could cause this issue) */
  potentialUpstreamCauses: ServiceNode[];
  /** Blast radius - services that would be affected if this fails */
  blastRadius: BlastRadiusInfo;
  /** Runbooks for this service and its dependencies */
  runbooks: RetrievedChunk[];
  /** Recent incidents involving this service or dependencies */
  recentIncidents: RetrievedChunk[];
  /** Known issues for this service */
  knownIssues: RetrievedChunk[];
}

/**
 * Information about the blast radius of a service failure.
 */
export interface BlastRadiusInfo {
  /** Direct dependents (1 hop) */
  directDependents: ServiceNode[];
  /** Transitive dependents (2+ hops) */
  transitiveDependents: ServiceNode[];
  /** Critical services in the blast radius */
  criticalServicesAffected: ServiceNode[];
  /** Total services affected */
  totalAffected: number;
  /** Impact paths to critical services */
  criticalPaths: ImpactPath[];
}

/**
 * Configuration for service context gathering.
 */
export interface ServiceContextConfig {
  /** Maximum dependency depth to traverse */
  maxDependencyDepth: number;
  /** Maximum dependents depth to traverse */
  maxDependentsDepth: number;
  /** Whether to include runbooks for dependencies */
  includeDepRunbooks: boolean;
  /** Maximum runbooks to include per service */
  maxRunbooksPerService: number;
  /** Whether to auto-load context for discovered services */
  autoLoadOnDiscovery: boolean;
}

const DEFAULT_CONFIG: ServiceContextConfig = {
  maxDependencyDepth: 2,
  maxDependentsDepth: 3,
  maxRunbooksPerService: 2,
  includeDepRunbooks: true,
  autoLoadOnDiscovery: true,
};

/**
 * ServiceContextManager provides service-aware context for investigations.
 */
export class ServiceContextManager {
  private readonly config: ServiceContextConfig;
  private readonly graph: ServiceGraph;
  private readonly knowledgeManager?: KnowledgeContextManager;

  /** Cached service contexts */
  private contextCache: Map<string, ServiceContext> = new Map();
  /** Services currently under investigation */
  private investigatingServices: Set<string> = new Set();

  constructor(
    graph: ServiceGraph,
    knowledgeManager?: KnowledgeContextManager,
    config: Partial<ServiceContextConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.graph = graph;
    this.knowledgeManager = knowledgeManager;
  }

  /**
   * Get or build context for a service.
   */
  async getServiceContext(serviceName: string): Promise<ServiceContext | null> {
    // Check cache first
    if (this.contextCache.has(serviceName)) {
      return this.contextCache.get(serviceName)!;
    }

    // Find service in graph
    const service = this.graph.getServiceByName(serviceName);
    if (!service) {
      return null;
    }

    // Build context
    const context = await this.buildServiceContext(service);
    this.contextCache.set(serviceName, context);
    this.investigatingServices.add(serviceName);

    return context;
  }

  /**
   * Build full context for a service.
   */
  private async buildServiceContext(service: ServiceNode): Promise<ServiceContext> {
    // Get direct dependencies and dependents
    const dependencies = this.graph.getDependencies(service.id);
    const dependents = this.graph.getDependents(service.id);

    // Find critical dependencies (direct dependencies with critical edges)
    const criticalDependencies = this.getCriticalDependencies(service.id);

    // Get potential upstream causes (services that could cause this issue)
    const potentialUpstreamCauses = this.getPotentialUpstreamCauses(service.id);

    // Calculate blast radius
    const blastRadius = this.calculateBlastRadius(service.id);

    // Get ownership information
    const ownership = this.knowledgeManager?.getServiceOwnership(service.name);

    // Get related knowledge
    const runbooks: RetrievedChunk[] = [];
    const recentIncidents: RetrievedChunk[] = [];
    const knownIssues: RetrievedChunk[] = [];

    if (this.knowledgeManager) {
      const knowledgeContext = this.knowledgeManager.getContext();

      // Find runbooks for this service
      for (const rb of knowledgeContext.relevantRunbooks) {
        if (rb.services.some(s => s.toLowerCase().includes(service.name.toLowerCase()))) {
          runbooks.push(rb);
        }
      }

      // Find known issues
      for (const ki of knowledgeContext.matchingKnownIssues) {
        if (ki.services.some(s => s.toLowerCase().includes(service.name.toLowerCase()))) {
          knownIssues.push(ki);
        }
      }

      // Find postmortems (recent incidents)
      for (const pm of knowledgeContext.relevantPostmortems) {
        if (pm.services.some(s => s.toLowerCase().includes(service.name.toLowerCase()))) {
          recentIncidents.push(pm);
        }
      }

      // Include runbooks for critical dependencies if enabled
      if (this.config.includeDepRunbooks) {
        for (const dep of criticalDependencies.slice(0, 3)) {
          for (const rb of knowledgeContext.relevantRunbooks) {
            if (
              rb.services.some(s => s.toLowerCase().includes(dep.name.toLowerCase())) &&
              !runbooks.some(r => r.id === rb.id)
            ) {
              runbooks.push(rb);
            }
          }
        }
      }
    }

    return {
      service,
      ownership,
      dependencies,
      dependents,
      criticalDependencies,
      potentialUpstreamCauses,
      blastRadius,
      runbooks: runbooks.slice(0, this.config.maxRunbooksPerService * 3),
      recentIncidents: recentIncidents.slice(0, 3),
      knownIssues: knownIssues.slice(0, 5),
    };
  }

  /**
   * Get critical dependencies (dependencies with critical edges).
   */
  private getCriticalDependencies(serviceId: string): ServiceNode[] {
    const critical: ServiceNode[] = [];
    const dependencies = this.graph.getDependencies(serviceId);

    for (const dep of dependencies) {
      const edge = this.graph.getDependency(serviceId, dep.id);
      if (edge && edge.criticality === 'critical') {
        critical.push(dep);
      }
    }

    return critical;
  }

  /**
   * Get potential upstream causes - services whose failure could cause this issue.
   */
  private getPotentialUpstreamCauses(serviceId: string): ServiceNode[] {
    const causes: ServiceNode[] = [];
    const visited = new Set<string>();

    const traverse = (current: string, depth: number) => {
      if (depth > this.config.maxDependencyDepth || visited.has(current)) return;
      visited.add(current);

      const dependencies = this.graph.getDependencies(current);
      for (const dep of dependencies) {
        // Prioritize critical and database dependencies
        if (dep.type === 'database' || dep.type === 'cache' || dep.tier === 'critical') {
          if (!causes.some(c => c.id === dep.id)) {
            causes.push(dep);
          }
        }

        const edge = this.graph.getDependency(current, dep.id);
        if (edge && edge.criticality !== 'optional') {
          if (!causes.some(c => c.id === dep.id)) {
            causes.push(dep);
          }
        }

        traverse(dep.id, depth + 1);
      }
    };

    traverse(serviceId, 0);
    return causes;
  }

  /**
   * Calculate the blast radius of a service failure.
   */
  private calculateBlastRadius(serviceId: string): BlastRadiusInfo {
    const impactPaths = this.graph.getUpstreamImpact(serviceId, this.config.maxDependentsDepth);

    const directDependents: ServiceNode[] = [];
    const transitiveDependents: ServiceNode[] = [];
    const criticalServicesAffected: ServiceNode[] = [];
    const criticalPaths: ImpactPath[] = [];
    const seen = new Set<string>();

    for (const path of impactPaths) {
      if (seen.has(path.affected)) continue;
      seen.add(path.affected);

      const affectedService = this.graph.getService(path.affected);
      if (!affectedService) continue;

      if (path.hops === 1) {
        directDependents.push(affectedService);
      } else {
        transitiveDependents.push(affectedService);
      }

      if (affectedService.tier === 'critical') {
        criticalServicesAffected.push(affectedService);
        if (path.criticality === 'critical') {
          criticalPaths.push(path);
        }
      }
    }

    return {
      directDependents,
      transitiveDependents,
      criticalServicesAffected,
      totalAffected: directDependents.length + transitiveDependents.length,
      criticalPaths,
    };
  }

  /**
   * Get contexts for multiple services discovered during investigation.
   */
  async getContextsForServices(serviceNames: string[]): Promise<Map<string, ServiceContext>> {
    const contexts = new Map<string, ServiceContext>();

    for (const name of serviceNames) {
      const context = await this.getServiceContext(name);
      if (context) {
        contexts.set(name, context);
      }
    }

    return contexts;
  }

  /**
   * Update context when new services are discovered.
   */
  async onServicesDiscovered(serviceNames: string[]): Promise<ServiceNode[]> {
    if (!this.config.autoLoadOnDiscovery) {
      return [];
    }

    const newServices: ServiceNode[] = [];

    for (const name of serviceNames) {
      if (!this.investigatingServices.has(name)) {
        const context = await this.getServiceContext(name);
        if (context) {
          newServices.push(context.service);
        }
      }
    }

    return newServices;
  }

  /**
   * Get services that should be checked based on current investigation.
   */
  getSuggestedServicesToCheck(): ServiceNode[] {
    const suggestions: ServiceNode[] = [];
    const checked = new Set<string>();

    for (const serviceName of this.investigatingServices) {
      const context = this.contextCache.get(serviceName);
      if (!context) continue;

      // Suggest checking critical dependencies that aren't yet being investigated
      for (const dep of context.criticalDependencies) {
        if (!this.investigatingServices.has(dep.name) && !checked.has(dep.id)) {
          suggestions.push(dep);
          checked.add(dep.id);
        }
      }

      // Suggest checking potential upstream causes
      for (const cause of context.potentialUpstreamCauses) {
        if (!this.investigatingServices.has(cause.name) && !checked.has(cause.id)) {
          suggestions.push(cause);
          checked.add(cause.id);
        }
      }
    }

    return suggestions;
  }

  /**
   * Build the service context section for system prompt.
   */
  buildServiceContextSection(): string {
    if (this.investigatingServices.size === 0) {
      return '';
    }

    const sections: string[] = [];
    sections.push('## Services Under Investigation\n');

    for (const serviceName of this.investigatingServices) {
      const context = this.contextCache.get(serviceName);
      if (!context) continue;

      sections.push(`### ${context.service.name}`);

      // Basic info
      if (context.ownership) {
        sections.push(`Team: ${context.ownership.team}, Slack: ${context.ownership.slackChannel}`);
      }
      sections.push(`Type: ${context.service.type}, Tier: ${context.service.tier || 'unknown'}`);

      // Dependencies
      if (context.criticalDependencies.length > 0) {
        sections.push(`Critical dependencies: ${context.criticalDependencies.map(d => d.name).join(', ')}`);
      }

      // Blast radius
      if (context.blastRadius.totalAffected > 0) {
        sections.push(`Blast radius: ${context.blastRadius.totalAffected} service(s) affected`);
        if (context.blastRadius.criticalServicesAffected.length > 0) {
          sections.push(
            `Critical services at risk: ${context.blastRadius.criticalServicesAffected.map(s => s.name).join(', ')}`
          );
        }
      }

      // Runbooks available
      if (context.runbooks.length > 0) {
        sections.push(`Available runbooks: ${context.runbooks.map(r => r.title).join(', ')}`);
      }

      // Known issues
      if (context.knownIssues.length > 0) {
        sections.push(`Known issues: ${context.knownIssues.length}`);
      }

      sections.push('');
    }

    // Suggestions
    const suggestions = this.getSuggestedServicesToCheck();
    if (suggestions.length > 0) {
      sections.push('**Suggested services to check:**');
      for (const svc of suggestions.slice(0, 5)) {
        sections.push(`- ${svc.name} (${svc.type}, ${svc.tier || 'unknown tier'})`);
      }
    }

    return sections.join('\n');
  }

  /**
   * Build compact summary for iteration prompts.
   */
  buildCompactSummary(): string {
    if (this.investigatingServices.size === 0) {
      return 'No services loaded in context.';
    }

    const parts: string[] = [];

    // Services being investigated
    parts.push(`Services: ${Array.from(this.investigatingServices).join(', ')}`);

    // Aggregate critical info
    let totalBlastRadius = 0;
    let criticalDeps = 0;

    for (const context of this.contextCache.values()) {
      totalBlastRadius += context.blastRadius.totalAffected;
      criticalDeps += context.criticalDependencies.length;
    }

    if (criticalDeps > 0) {
      parts.push(`Critical dependencies: ${criticalDeps}`);
    }

    if (totalBlastRadius > 0) {
      parts.push(`Total blast radius: ${totalBlastRadius} service(s)`);
    }

    return parts.join('; ');
  }

  /**
   * Get escalation information for a service.
   */
  getEscalationInfo(serviceName: string): {
    team?: string;
    slackChannel?: string;
    pagerdutyId?: string;
    oncallSchedule?: string;
  } | null {
    const context = this.contextCache.get(serviceName);
    if (!context || !context.ownership) {
      return null;
    }

    return {
      team: context.ownership.team,
      slackChannel: context.ownership.slackChannel,
      pagerdutyId: context.ownership.pagerdutyServiceId,
      oncallSchedule: context.ownership.oncallSchedule,
    };
  }

  /**
   * Check if a service is in the blast radius of any investigated service.
   */
  isInBlastRadius(serviceName: string): boolean {
    for (const context of this.contextCache.values()) {
      if (
        context.blastRadius.directDependents.some(d => d.name === serviceName) ||
        context.blastRadius.transitiveDependents.some(d => d.name === serviceName)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Find path between two services.
   */
  findDependencyPath(from: string, to: string): string[] | null {
    const fromService = this.graph.getServiceByName(from);
    const toService = this.graph.getServiceByName(to);

    if (!fromService || !toService) {
      return null;
    }

    return this.graph.findPath(fromService.id, toService.id);
  }

  /**
   * Clear context for a new investigation.
   */
  reset(): void {
    this.contextCache.clear();
    this.investigatingServices.clear();
  }

  /**
   * Get all services currently in context.
   */
  getInvestigatingServices(): string[] {
    return Array.from(this.investigatingServices);
  }

  /**
   * Check if service graph is available.
   */
  hasGraph(): boolean {
    return this.graph.getAllServices().length > 0;
  }

  /**
   * Get graph statistics.
   */
  getGraphStats(): { services: number; dependencies: number } {
    const stats = this.graph.getStats();
    return {
      services: stats.nodeCount,
      dependencies: stats.edgeCount,
    };
  }
}
