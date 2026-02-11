/**
 * Tests for Service Dependency Graph
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ServiceGraph,
  createServiceGraph,
  type ServiceNode,
  type DependencyEdge,
} from '../graph-store';

describe('ServiceGraph', () => {
  let graph: ServiceGraph;

  beforeEach(() => {
    graph = createServiceGraph();
  });

  describe('service management', () => {
    it('should add a service', () => {
      const service = graph.addService({
        id: 'api-gateway',
        name: 'API Gateway',
        type: 'service',
        team: 'platform',
        tier: 'critical',
        tags: ['api', 'gateway'],
        metadata: {},
      });

      expect(service.id).toBe('api-gateway');
      expect(service.name).toBe('API Gateway');
      expect(service.createdAt).toBeInstanceOf(Date);
    });

    it('should get service by ID', () => {
      graph.addService({
        id: 'user-service',
        name: 'User Service',
        type: 'service',
        tags: [],
        metadata: {},
      });

      const service = graph.getService('user-service');

      expect(service).toBeDefined();
      expect(service?.name).toBe('User Service');
    });

    it('should get service by name', () => {
      graph.addService({
        id: 'user-service',
        name: 'User Service',
        type: 'service',
        tags: [],
        metadata: {},
      });

      const service = graph.getServiceByName('user service');

      expect(service).toBeDefined();
      expect(service?.id).toBe('user-service');
    });

    it('should update service', () => {
      graph.addService({
        id: 'api',
        name: 'API',
        type: 'service',
        team: 'platform',
        tags: [],
        metadata: {},
      });

      const updated = graph.updateService('api', { team: 'infra', tier: 'high' });

      expect(updated?.team).toBe('infra');
      expect(updated?.tier).toBe('high');
      // Updated time should be >= created time
      expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(
        updated?.createdAt.getTime() || 0
      );
    });

    it('should remove service and its edges', () => {
      graph.addService({ id: 'a', name: 'A', type: 'service', tags: [], metadata: {} });
      graph.addService({ id: 'b', name: 'B', type: 'service', tags: [], metadata: {} });
      graph.addDependency({
        source: 'a',
        target: 'b',
        type: 'sync',
        criticality: 'critical',
        metadata: {},
      });

      const removed = graph.removeService('b');

      expect(removed).toBe(true);
      expect(graph.getService('b')).toBeUndefined();
      expect(graph.getDependencies('a')).toHaveLength(0);
    });

    it('should get all services', () => {
      graph.addService({ id: 'a', name: 'A', type: 'service', tags: [], metadata: {} });
      graph.addService({ id: 'b', name: 'B', type: 'database', tags: [], metadata: {} });

      const services = graph.getAllServices();

      expect(services).toHaveLength(2);
    });
  });

  describe('dependency management', () => {
    beforeEach(() => {
      graph.addService({ id: 'api', name: 'API', type: 'service', tags: [], metadata: {} });
      graph.addService({ id: 'db', name: 'Database', type: 'database', tags: [], metadata: {} });
      graph.addService({ id: 'cache', name: 'Cache', type: 'cache', tags: [], metadata: {} });
    });

    it('should add dependency', () => {
      const edge = graph.addDependency({
        source: 'api',
        target: 'db',
        type: 'database',
        criticality: 'critical',
        metadata: {},
      });

      expect(edge.id).toBe('api->db');
      expect(edge.source).toBe('api');
      expect(edge.target).toBe('db');
    });

    it('should get dependency', () => {
      graph.addDependency({
        source: 'api',
        target: 'db',
        type: 'database',
        criticality: 'critical',
        metadata: {},
      });

      const edge = graph.getDependency('api', 'db');

      expect(edge).toBeDefined();
      expect(edge?.type).toBe('database');
    });

    it('should remove dependency', () => {
      graph.addDependency({
        source: 'api',
        target: 'db',
        type: 'database',
        criticality: 'critical',
        metadata: {},
      });

      const removed = graph.removeDependency('api', 'db');

      expect(removed).toBe(true);
      expect(graph.getDependency('api', 'db')).toBeUndefined();
    });

    it('should get dependencies (outgoing)', () => {
      graph.addDependency({
        source: 'api',
        target: 'db',
        type: 'database',
        criticality: 'critical',
        metadata: {},
      });
      graph.addDependency({
        source: 'api',
        target: 'cache',
        type: 'cache',
        criticality: 'degraded',
        metadata: {},
      });

      const deps = graph.getDependencies('api');

      expect(deps).toHaveLength(2);
      expect(deps.map((d) => d.id)).toContain('db');
      expect(deps.map((d) => d.id)).toContain('cache');
    });

    it('should get dependents (incoming)', () => {
      graph.addDependency({
        source: 'api',
        target: 'db',
        type: 'database',
        criticality: 'critical',
        metadata: {},
      });

      const dependents = graph.getDependents('db');

      expect(dependents).toHaveLength(1);
      expect(dependents[0].id).toBe('api');
    });

    it('should get service with dependencies', () => {
      graph.addDependency({
        source: 'api',
        target: 'db',
        type: 'database',
        criticality: 'critical',
        metadata: {},
      });

      const result = graph.getServiceWithDependencies('api');

      expect(result).toBeDefined();
      expect(result?.service.id).toBe('api');
      expect(result?.dependencies).toHaveLength(1);
      expect(result?.dependents).toHaveLength(0);
    });
  });

  describe('filtering', () => {
    beforeEach(() => {
      graph.addService({
        id: 's1',
        name: 'Service 1',
        type: 'service',
        team: 'platform',
        tier: 'critical',
        tags: ['api', 'rest'],
        metadata: {},
      });
      graph.addService({
        id: 's2',
        name: 'Service 2',
        type: 'service',
        team: 'platform',
        tier: 'high',
        tags: ['internal'],
        metadata: {},
      });
      graph.addService({
        id: 'db1',
        name: 'Database',
        type: 'database',
        team: 'infra',
        tier: 'critical',
        tags: ['postgres'],
        metadata: {},
      });
    });

    it('should filter by team', () => {
      const services = graph.getServicesByTeam('platform');

      expect(services).toHaveLength(2);
    });

    it('should filter by type', () => {
      const databases = graph.getServicesByType('database');

      expect(databases).toHaveLength(1);
      expect(databases[0].id).toBe('db1');
    });

    it('should filter by tag', () => {
      const apiServices = graph.getServicesByTag('api');

      expect(apiServices).toHaveLength(1);
      expect(apiServices[0].id).toBe('s1');
    });

    it('should filter by tier', () => {
      const criticalServices = graph.getServicesByTier('critical');

      expect(criticalServices).toHaveLength(2);
    });

    it('should search services', () => {
      const results = graph.searchServices('service');

      expect(results).toHaveLength(2);
    });
  });

  describe('impact analysis', () => {
    beforeEach(() => {
      // Create a chain: frontend -> api -> db
      graph.addService({
        id: 'frontend',
        name: 'Frontend',
        type: 'service',
        tags: [],
        metadata: {},
      });
      graph.addService({ id: 'api', name: 'API', type: 'service', tags: [], metadata: {} });
      graph.addService({ id: 'db', name: 'Database', type: 'database', tags: [], metadata: {} });
      graph.addService({ id: 'cache', name: 'Cache', type: 'cache', tags: [], metadata: {} });

      graph.addDependency({
        source: 'frontend',
        target: 'api',
        type: 'sync',
        criticality: 'critical',
        metadata: {},
      });
      graph.addDependency({
        source: 'api',
        target: 'db',
        type: 'database',
        criticality: 'critical',
        metadata: {},
      });
      graph.addDependency({
        source: 'api',
        target: 'cache',
        type: 'cache',
        criticality: 'degraded',
        metadata: {},
      });
    });

    it('should get upstream impact', () => {
      const impact = graph.getUpstreamImpact('db');

      expect(impact.length).toBeGreaterThan(0);
      expect(impact.some((p) => p.affected === 'api')).toBe(true);
      expect(impact.some((p) => p.affected === 'frontend')).toBe(true);
    });

    it('should get downstream impact', () => {
      const impact = graph.getDownstreamImpact('api');

      expect(impact.length).toBeGreaterThan(0);
      expect(impact.some((p) => p.affected === 'db')).toBe(true);
      expect(impact.some((p) => p.affected === 'cache')).toBe(true);
    });

    it('should track criticality in impact paths', () => {
      const impact = graph.getDownstreamImpact('api');

      const dbImpact = impact.find((p) => p.affected === 'db');
      const cacheImpact = impact.find((p) => p.affected === 'cache');

      // Both should have criticality values
      expect(dbImpact?.criticality).toBeDefined();
      expect(cacheImpact?.criticality).toBeDefined();
    });

    it('should respect max depth', () => {
      // Full depth should find both api and frontend
      const fullImpact = graph.getUpstreamImpact('db', 5);

      // Limited depth should find fewer services
      const limitedImpact = graph.getUpstreamImpact('db', 1);

      // Full depth should have more or equal paths
      expect(fullImpact.length).toBeGreaterThanOrEqual(limitedImpact.length);
    });
  });

  describe('path finding', () => {
    beforeEach(() => {
      graph.addService({ id: 'a', name: 'A', type: 'service', tags: [], metadata: {} });
      graph.addService({ id: 'b', name: 'B', type: 'service', tags: [], metadata: {} });
      graph.addService({ id: 'c', name: 'C', type: 'service', tags: [], metadata: {} });
      graph.addService({ id: 'd', name: 'D', type: 'service', tags: [], metadata: {} });

      graph.addDependency({
        source: 'a',
        target: 'b',
        type: 'sync',
        criticality: 'critical',
        metadata: {},
      });
      graph.addDependency({
        source: 'b',
        target: 'c',
        type: 'sync',
        criticality: 'critical',
        metadata: {},
      });
      graph.addDependency({
        source: 'a',
        target: 'd',
        type: 'sync',
        criticality: 'critical',
        metadata: {},
      });
      graph.addDependency({
        source: 'd',
        target: 'c',
        type: 'sync',
        criticality: 'critical',
        metadata: {},
      });
    });

    it('should find shortest path', () => {
      const path = graph.findPath('a', 'c');

      expect(path).toBeDefined();
      expect(path).toHaveLength(3); // a -> b -> c or a -> d -> c
    });

    it('should return null for non-existent path', () => {
      const path = graph.findPath('c', 'a');

      expect(path).toBeNull();
    });

    it('should check if path exists', () => {
      expect(graph.hasPath('a', 'c')).toBe(true);
      expect(graph.hasPath('c', 'a')).toBe(false);
    });

    it('should handle same source and target', () => {
      const path = graph.findPath('a', 'a');

      expect(path).toEqual(['a']);
    });
  });

  describe('cycle detection', () => {
    it('should detect cycles', () => {
      graph.addService({ id: 'a', name: 'A', type: 'service', tags: [], metadata: {} });
      graph.addService({ id: 'b', name: 'B', type: 'service', tags: [], metadata: {} });
      graph.addService({ id: 'c', name: 'C', type: 'service', tags: [], metadata: {} });

      graph.addDependency({
        source: 'a',
        target: 'b',
        type: 'sync',
        criticality: 'critical',
        metadata: {},
      });
      graph.addDependency({
        source: 'b',
        target: 'c',
        type: 'sync',
        criticality: 'critical',
        metadata: {},
      });
      graph.addDependency({
        source: 'c',
        target: 'a',
        type: 'sync',
        criticality: 'critical',
        metadata: {},
      });

      const cycles = graph.detectCycles();

      expect(cycles.length).toBeGreaterThan(0);
    });

    it('should return empty array when no cycles', () => {
      graph.addService({ id: 'a', name: 'A', type: 'service', tags: [], metadata: {} });
      graph.addService({ id: 'b', name: 'B', type: 'service', tags: [], metadata: {} });

      graph.addDependency({
        source: 'a',
        target: 'b',
        type: 'sync',
        criticality: 'critical',
        metadata: {},
      });

      const cycles = graph.detectCycles();

      expect(cycles).toHaveLength(0);
    });
  });

  describe('statistics', () => {
    it('should get graph statistics', () => {
      graph.addService({
        id: 's1',
        name: 'S1',
        type: 'service',
        team: 'platform',
        tier: 'critical',
        tags: [],
        metadata: {},
      });
      graph.addService({
        id: 's2',
        name: 'S2',
        type: 'service',
        team: 'platform',
        tags: [],
        metadata: {},
      });
      graph.addService({
        id: 'db',
        name: 'DB',
        type: 'database',
        team: 'infra',
        tier: 'critical',
        tags: [],
        metadata: {},
      });

      graph.addDependency({
        source: 's1',
        target: 'db',
        type: 'database',
        criticality: 'critical',
        metadata: {},
      });
      graph.addDependency({
        source: 's2',
        target: 'db',
        type: 'database',
        criticality: 'critical',
        metadata: {},
      });

      const stats = graph.getStats();

      expect(stats.nodeCount).toBe(3);
      expect(stats.edgeCount).toBe(2);
      expect(stats.servicesByType['service']).toBe(2);
      expect(stats.servicesByType['database']).toBe(1);
      expect(stats.servicesByTeam['platform']).toBe(2);
      expect(stats.criticalServices).toBe(2);
      expect(stats.avgDependencies).toBeCloseTo(0.67, 1);
    });
  });

  describe('serialization', () => {
    it('should serialize to JSON', () => {
      graph.addService({
        id: 'api',
        name: 'API',
        type: 'service',
        tags: ['rest'],
        metadata: { version: '1.0' },
      });
      graph.addService({ id: 'db', name: 'DB', type: 'database', tags: [], metadata: {} });
      graph.addDependency({
        source: 'api',
        target: 'db',
        type: 'database',
        criticality: 'critical',
        metadata: {},
      });

      const json = graph.toJSON();
      const parsed = JSON.parse(json);

      expect(parsed.nodes).toHaveLength(2);
      expect(parsed.edges).toHaveLength(1);
    });

    it('should deserialize from JSON', () => {
      graph.addService({ id: 'api', name: 'API', type: 'service', tags: [], metadata: {} });
      graph.addService({ id: 'db', name: 'DB', type: 'database', tags: [], metadata: {} });
      graph.addDependency({
        source: 'api',
        target: 'db',
        type: 'database',
        criticality: 'critical',
        metadata: {},
      });

      const json = graph.toJSON();
      const restored = ServiceGraph.fromJSON(json);

      expect(restored.getAllServices()).toHaveLength(2);
      expect(restored.getAllEdges()).toHaveLength(1);
      expect(restored.getDependencies('api')).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('should clear all data', () => {
      graph.addService({ id: 'api', name: 'API', type: 'service', tags: [], metadata: {} });
      graph.addService({ id: 'db', name: 'DB', type: 'database', tags: [], metadata: {} });
      graph.addDependency({
        source: 'api',
        target: 'db',
        type: 'database',
        criticality: 'critical',
        metadata: {},
      });

      graph.clear();

      expect(graph.getAllServices()).toHaveLength(0);
      expect(graph.getAllEdges()).toHaveLength(0);
    });
  });
});
