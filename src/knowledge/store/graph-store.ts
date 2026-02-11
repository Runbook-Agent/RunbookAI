/**
 * Service Dependency Graph Store
 *
 * Stores and queries service relationships, dependencies, and ownership.
 * Supports traversal for impact analysis and root cause investigation.
 */

/**
 * Service node in the graph
 */
export interface ServiceNode {
  id: string;
  name: string;
  type: 'service' | 'database' | 'cache' | 'queue' | 'external' | 'infrastructure';
  team?: string;
  owner?: string;
  tier?: 'critical' | 'high' | 'medium' | 'low';
  repository?: string;
  documentation?: string;
  runbooks?: string[];
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Edge representing a dependency between services
 */
export interface DependencyEdge {
  id: string;
  source: string; // Service ID that depends on target
  target: string; // Service ID that is depended upon
  type: 'sync' | 'async' | 'database' | 'cache' | 'queue' | 'external';
  protocol?: string; // http, grpc, amqp, etc.
  criticality: 'critical' | 'degraded' | 'optional';
  description?: string;
  metadata: Record<string, unknown>;
}

/**
 * Impact path from source to affected services
 */
export interface ImpactPath {
  source: string;
  affected: string;
  path: string[];
  hops: number;
  criticality: 'critical' | 'degraded' | 'optional';
}

/**
 * Service with its dependencies
 */
export interface ServiceWithDependencies {
  service: ServiceNode;
  dependencies: ServiceNode[]; // Services this one depends on
  dependents: ServiceNode[]; // Services that depend on this one
}

/**
 * Graph statistics
 */
export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  servicesByType: Record<string, number>;
  servicesByTeam: Record<string, number>;
  avgDependencies: number;
  criticalServices: number;
}

/**
 * Service Dependency Graph
 */
export class ServiceGraph {
  private nodes: Map<string, ServiceNode> = new Map();
  private edges: Map<string, DependencyEdge> = new Map();
  private outgoing: Map<string, Set<string>> = new Map(); // service -> edges going out
  private incoming: Map<string, Set<string>> = new Map(); // service -> edges coming in

  /**
   * Add a service node
   */
  addService(service: Omit<ServiceNode, 'createdAt' | 'updatedAt'>): ServiceNode {
    const now = new Date();
    const node: ServiceNode = {
      ...service,
      createdAt: now,
      updatedAt: now,
    };

    this.nodes.set(service.id, node);

    // Initialize edge sets if not exists
    if (!this.outgoing.has(service.id)) {
      this.outgoing.set(service.id, new Set());
    }
    if (!this.incoming.has(service.id)) {
      this.incoming.set(service.id, new Set());
    }

    return node;
  }

  /**
   * Get a service by ID
   */
  getService(id: string): ServiceNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Get a service by name (case-insensitive)
   */
  getServiceByName(name: string): ServiceNode | undefined {
    const lowerName = name.toLowerCase();
    for (const node of this.nodes.values()) {
      if (node.name.toLowerCase() === lowerName) {
        return node;
      }
    }
    return undefined;
  }

  /**
   * Update a service
   */
  updateService(
    id: string,
    updates: Partial<Omit<ServiceNode, 'id' | 'createdAt'>>
  ): ServiceNode | undefined {
    const existing = this.nodes.get(id);
    if (!existing) return undefined;

    const updated: ServiceNode = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };

    this.nodes.set(id, updated);
    return updated;
  }

  /**
   * Remove a service and its edges
   */
  removeService(id: string): boolean {
    if (!this.nodes.has(id)) return false;

    // Remove all edges involving this service
    const outgoingEdges = this.outgoing.get(id) || new Set();
    const incomingEdges = this.incoming.get(id) || new Set();

    for (const edgeId of outgoingEdges) {
      const edge = this.edges.get(edgeId);
      if (edge) {
        this.incoming.get(edge.target)?.delete(edgeId);
        this.edges.delete(edgeId);
      }
    }

    for (const edgeId of incomingEdges) {
      const edge = this.edges.get(edgeId);
      if (edge) {
        this.outgoing.get(edge.source)?.delete(edgeId);
        this.edges.delete(edgeId);
      }
    }

    this.outgoing.delete(id);
    this.incoming.delete(id);
    this.nodes.delete(id);

    return true;
  }

  /**
   * Add a dependency edge
   */
  addDependency(edge: Omit<DependencyEdge, 'id'>): DependencyEdge {
    const id = `${edge.source}->${edge.target}`;
    const fullEdge: DependencyEdge = { ...edge, id };

    this.edges.set(id, fullEdge);

    // Update adjacency lists
    if (!this.outgoing.has(edge.source)) {
      this.outgoing.set(edge.source, new Set());
    }
    this.outgoing.get(edge.source)!.add(id);

    if (!this.incoming.has(edge.target)) {
      this.incoming.set(edge.target, new Set());
    }
    this.incoming.get(edge.target)!.add(id);

    return fullEdge;
  }

  /**
   * Get dependency edge between two services
   */
  getDependency(source: string, target: string): DependencyEdge | undefined {
    return this.edges.get(`${source}->${target}`);
  }

  /**
   * Remove a dependency edge
   */
  removeDependency(source: string, target: string): boolean {
    const id = `${source}->${target}`;
    if (!this.edges.has(id)) return false;

    this.outgoing.get(source)?.delete(id);
    this.incoming.get(target)?.delete(id);
    this.edges.delete(id);

    return true;
  }

  /**
   * Get all services this service depends on (outgoing dependencies)
   */
  getDependencies(serviceId: string): ServiceNode[] {
    const edgeIds = this.outgoing.get(serviceId) || new Set();
    const dependencies: ServiceNode[] = [];

    for (const edgeId of edgeIds) {
      const edge = this.edges.get(edgeId);
      if (edge) {
        const target = this.nodes.get(edge.target);
        if (target) {
          dependencies.push(target);
        }
      }
    }

    return dependencies;
  }

  /**
   * Get all services that depend on this service (incoming dependencies)
   */
  getDependents(serviceId: string): ServiceNode[] {
    const edgeIds = this.incoming.get(serviceId) || new Set();
    const dependents: ServiceNode[] = [];

    for (const edgeId of edgeIds) {
      const edge = this.edges.get(edgeId);
      if (edge) {
        const source = this.nodes.get(edge.source);
        if (source) {
          dependents.push(source);
        }
      }
    }

    return dependents;
  }

  /**
   * Get service with all its dependencies and dependents
   */
  getServiceWithDependencies(serviceId: string): ServiceWithDependencies | undefined {
    const service = this.nodes.get(serviceId);
    if (!service) return undefined;

    return {
      service,
      dependencies: this.getDependencies(serviceId),
      dependents: this.getDependents(serviceId),
    };
  }

  /**
   * Get all services
   */
  getAllServices(): ServiceNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get all edges
   */
  getAllEdges(): DependencyEdge[] {
    return Array.from(this.edges.values());
  }

  /**
   * Get services by team
   */
  getServicesByTeam(team: string): ServiceNode[] {
    return Array.from(this.nodes.values()).filter(
      (node) => node.team?.toLowerCase() === team.toLowerCase()
    );
  }

  /**
   * Get services by type
   */
  getServicesByType(type: ServiceNode['type']): ServiceNode[] {
    return Array.from(this.nodes.values()).filter((node) => node.type === type);
  }

  /**
   * Get services by tag
   */
  getServicesByTag(tag: string): ServiceNode[] {
    const lowerTag = tag.toLowerCase();
    return Array.from(this.nodes.values()).filter((node) =>
      node.tags.some((t) => t.toLowerCase() === lowerTag)
    );
  }

  /**
   * Get services by tier
   */
  getServicesByTier(tier: ServiceNode['tier']): ServiceNode[] {
    return Array.from(this.nodes.values()).filter((node) => node.tier === tier);
  }

  /**
   * Search services by name or tags
   */
  searchServices(query: string): ServiceNode[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.nodes.values()).filter(
      (node) =>
        node.name.toLowerCase().includes(lowerQuery) ||
        node.tags.some((t) => t.toLowerCase().includes(lowerQuery)) ||
        node.team?.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get upstream impact path (what this service affects)
   */
  getUpstreamImpact(serviceId: string, maxDepth: number = 5): ImpactPath[] {
    const paths: ImpactPath[] = [];
    const visited = new Set<string>();

    const traverse = (
      current: string,
      path: string[],
      depth: number,
      criticality: 'critical' | 'degraded' | 'optional'
    ) => {
      if (depth > maxDepth || visited.has(current)) return;
      visited.add(current);

      const edgeIds = this.incoming.get(current) || new Set();

      for (const edgeId of edgeIds) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;

        const newPath = [...path, edge.source];
        const newCriticality = this.mergeCriticality(criticality, edge.criticality);

        paths.push({
          source: serviceId,
          affected: edge.source,
          path: newPath,
          hops: newPath.length,
          criticality: newCriticality,
        });

        traverse(edge.source, newPath, depth + 1, newCriticality);
      }
    };

    traverse(serviceId, [serviceId], 0, 'critical');
    return paths.sort((a, b) => a.hops - b.hops);
  }

  /**
   * Get downstream impact path (what this service depends on)
   */
  getDownstreamImpact(serviceId: string, maxDepth: number = 5): ImpactPath[] {
    const paths: ImpactPath[] = [];
    const visited = new Set<string>();

    const traverse = (
      current: string,
      path: string[],
      depth: number,
      criticality: 'critical' | 'degraded' | 'optional'
    ) => {
      if (depth > maxDepth || visited.has(current)) return;
      visited.add(current);

      const edgeIds = this.outgoing.get(current) || new Set();

      for (const edgeId of edgeIds) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;

        const newPath = [...path, edge.target];
        const newCriticality = this.mergeCriticality(criticality, edge.criticality);

        paths.push({
          source: serviceId,
          affected: edge.target,
          path: newPath,
          hops: newPath.length,
          criticality: newCriticality,
        });

        traverse(edge.target, newPath, depth + 1, newCriticality);
      }
    };

    traverse(serviceId, [serviceId], 0, 'critical');
    return paths.sort((a, b) => a.hops - b.hops);
  }

  /**
   * Merge two criticality levels (takes the lower of the two)
   */
  private mergeCriticality(
    a: 'critical' | 'degraded' | 'optional',
    b: 'critical' | 'degraded' | 'optional'
  ): 'critical' | 'degraded' | 'optional' {
    const order = { critical: 0, degraded: 1, optional: 2 };
    return order[a] <= order[b] ? a : b;
  }

  /**
   * Find shortest path between two services
   */
  findPath(from: string, to: string): string[] | null {
    if (from === to) return [from];
    if (!this.nodes.has(from) || !this.nodes.has(to)) return null;

    const visited = new Set<string>();
    const queue: Array<{ node: string; path: string[] }> = [{ node: from, path: [from] }];

    while (queue.length > 0) {
      const { node, path } = queue.shift()!;

      if (visited.has(node)) continue;
      visited.add(node);

      const edgeIds = this.outgoing.get(node) || new Set();

      for (const edgeId of edgeIds) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;

        const newPath = [...path, edge.target];

        if (edge.target === to) {
          return newPath;
        }

        if (!visited.has(edge.target)) {
          queue.push({ node: edge.target, path: newPath });
        }
      }
    }

    return null;
  }

  /**
   * Check if there's a path between two services
   */
  hasPath(from: string, to: string): boolean {
    return this.findPath(from, to) !== null;
  }

  /**
   * Detect cycles in the graph
   */
  detectCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (node: string, path: string[]): void => {
      visited.add(node);
      recursionStack.add(node);

      const edgeIds = this.outgoing.get(node) || new Set();

      for (const edgeId of edgeIds) {
        const edge = this.edges.get(edgeId);
        if (!edge) continue;

        if (!visited.has(edge.target)) {
          dfs(edge.target, [...path, edge.target]);
        } else if (recursionStack.has(edge.target)) {
          // Found a cycle
          const cycleStart = path.indexOf(edge.target);
          if (cycleStart !== -1) {
            cycles.push([...path.slice(cycleStart), edge.target]);
          }
        }
      }

      recursionStack.delete(node);
    };

    for (const node of this.nodes.keys()) {
      if (!visited.has(node)) {
        dfs(node, [node]);
      }
    }

    return cycles;
  }

  /**
   * Get graph statistics
   */
  getStats(): GraphStats {
    const servicesByType: Record<string, number> = {};
    const servicesByTeam: Record<string, number> = {};
    let totalDependencies = 0;
    let criticalCount = 0;

    for (const node of this.nodes.values()) {
      servicesByType[node.type] = (servicesByType[node.type] || 0) + 1;

      if (node.team) {
        servicesByTeam[node.team] = (servicesByTeam[node.team] || 0) + 1;
      }

      if (node.tier === 'critical') {
        criticalCount++;
      }

      totalDependencies += this.outgoing.get(node.id)?.size || 0;
    }

    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      servicesByType,
      servicesByTeam,
      avgDependencies: this.nodes.size > 0 ? totalDependencies / this.nodes.size : 0,
      criticalServices: criticalCount,
    };
  }

  /**
   * Export graph to JSON
   */
  toJSON(): string {
    return JSON.stringify(
      {
        nodes: Array.from(this.nodes.values()),
        edges: Array.from(this.edges.values()),
      },
      null,
      2
    );
  }

  /**
   * Import graph from JSON
   */
  static fromJSON(json: string): ServiceGraph {
    const data = JSON.parse(json);
    const graph = new ServiceGraph();

    for (const node of data.nodes) {
      graph.addService({
        ...node,
        createdAt: new Date(node.createdAt),
        updatedAt: new Date(node.updatedAt),
      });
    }

    for (const edge of data.edges) {
      graph.addDependency(edge);
    }

    return graph;
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.outgoing.clear();
    this.incoming.clear();
  }
}

/**
 * Create a new service graph
 */
export function createServiceGraph(): ServiceGraph {
  return new ServiceGraph();
}
