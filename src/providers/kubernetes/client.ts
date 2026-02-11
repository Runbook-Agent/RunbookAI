/**
 * Kubernetes Client Wrapper
 *
 * Provides a unified interface for interacting with Kubernetes clusters.
 * Supports multiple contexts, namespaces, and common K8s operations.
 */

import { spawn } from 'child_process';

/**
 * Kubernetes resource types
 */
export type KubernetesResourceType =
  | 'pods'
  | 'deployments'
  | 'services'
  | 'configmaps'
  | 'secrets'
  | 'ingresses'
  | 'nodes'
  | 'namespaces'
  | 'events'
  | 'jobs'
  | 'cronjobs'
  | 'daemonsets'
  | 'statefulsets'
  | 'replicasets'
  | 'persistentvolumes'
  | 'persistentvolumeclaims'
  | 'storageclasses'
  | 'hpa';

/**
 * Pod status
 */
export interface PodStatus {
  name: string;
  namespace: string;
  status: string;
  ready: string;
  restarts: number;
  age: string;
  node?: string;
  ip?: string;
  containers: Array<{
    name: string;
    ready: boolean;
    restartCount: number;
    state: string;
    lastState?: string;
  }>;
}

/**
 * Deployment status
 */
export interface DeploymentStatus {
  name: string;
  namespace: string;
  ready: string;
  upToDate: number;
  available: number;
  age: string;
  image?: string;
  replicas: {
    desired: number;
    current: number;
    ready: number;
    available: number;
  };
}

/**
 * Node status
 */
export interface NodeStatus {
  name: string;
  status: string;
  roles: string[];
  age: string;
  version: string;
  internalIP?: string;
  externalIP?: string;
  conditions: Array<{
    type: string;
    status: string;
    reason?: string;
    message?: string;
  }>;
  capacity: {
    cpu: string;
    memory: string;
    pods: string;
  };
  allocatable: {
    cpu: string;
    memory: string;
    pods: string;
  };
}

/**
 * Event info
 */
export interface KubernetesEvent {
  namespace: string;
  lastSeen: string;
  type: string;
  reason: string;
  object: string;
  message: string;
}

/**
 * Kubernetes client configuration
 */
export interface KubernetesClientConfig {
  context?: string;
  namespace?: string;
  kubeconfig?: string;
}

/**
 * Execute kubectl command
 */
async function kubectl(
  args: string[],
  config?: KubernetesClientConfig
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const cmdArgs = [...args];

    if (config?.context) {
      cmdArgs.unshift('--context', config.context);
    }
    if (config?.namespace) {
      cmdArgs.unshift('--namespace', config.namespace);
    }
    if (config?.kubeconfig) {
      cmdArgs.unshift('--kubeconfig', config.kubeconfig);
    }

    const proc = spawn('kubectl', cmdArgs, {
      env: process.env,
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode || 0 });
    });

    proc.on('error', (error) => {
      resolve({ stdout: '', stderr: error.message, exitCode: 1 });
    });
  });
}

/**
 * Parse kubectl JSON output
 */
function parseKubectlJson<T>(stdout: string): T | null {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * Kubernetes Client
 */
export class KubernetesClient {
  private config: KubernetesClientConfig;

  constructor(config: KubernetesClientConfig = {}) {
    this.config = config;
  }

  /**
   * Check if kubectl is available
   */
  async isAvailable(): Promise<boolean> {
    const result = await kubectl(['version', '--client', '-o', 'json']);
    return result.exitCode === 0;
  }

  /**
   * Get current context
   */
  async getCurrentContext(): Promise<string | null> {
    const result = await kubectl(['config', 'current-context']);
    if (result.exitCode !== 0) return null;
    return result.stdout.trim();
  }

  /**
   * List available contexts
   */
  async listContexts(): Promise<string[]> {
    const result = await kubectl(['config', 'get-contexts', '-o', 'name']);
    if (result.exitCode !== 0) return [];
    return result.stdout.trim().split('\n').filter(Boolean);
  }

  /**
   * List namespaces
   */
  async listNamespaces(): Promise<string[]> {
    const result = await kubectl(['get', 'namespaces', '-o', 'json'], this.config);
    if (result.exitCode !== 0) return [];

    const data = parseKubectlJson<{ items: Array<{ metadata: { name: string } }> }>(result.stdout);
    if (!data) return [];

    return data.items.map((item) => item.metadata.name);
  }

  /**
   * Get pods
   */
  async getPods(namespace?: string, labelSelector?: string): Promise<PodStatus[]> {
    const args = ['get', 'pods', '-o', 'json'];
    if (labelSelector) {
      args.push('-l', labelSelector);
    }

    const config = namespace ? { ...this.config, namespace } : this.config;
    const result = await kubectl(args, config);

    if (result.exitCode !== 0) return [];

    interface K8sPodItem {
      metadata: { name: string; namespace: string; creationTimestamp: string };
      spec: { nodeName?: string };
      status: {
        phase: string;
        podIP?: string;
        containerStatuses?: Array<{
          name: string;
          ready: boolean;
          restartCount: number;
          state: Record<string, unknown>;
          lastState?: Record<string, unknown>;
        }>;
      };
    }

    const data = parseKubectlJson<{ items: K8sPodItem[] }>(result.stdout);
    if (!data) return [];

    return data.items.map((pod) => {
      const containerStatuses = pod.status.containerStatuses || [];
      const readyContainers = containerStatuses.filter((c) => c.ready).length;
      const totalContainers = containerStatuses.length;
      const restarts = containerStatuses.reduce((sum, c) => sum + c.restartCount, 0);

      return {
        name: pod.metadata.name,
        namespace: pod.metadata.namespace,
        status: pod.status.phase,
        ready: `${readyContainers}/${totalContainers}`,
        restarts,
        age: this.calculateAge(pod.metadata.creationTimestamp),
        node: pod.spec.nodeName,
        ip: pod.status.podIP,
        containers: containerStatuses.map((c) => ({
          name: c.name,
          ready: c.ready,
          restartCount: c.restartCount,
          state: Object.keys(c.state)[0] || 'unknown',
          lastState: c.lastState ? Object.keys(c.lastState)[0] : undefined,
        })),
      };
    });
  }

  /**
   * Get deployments
   */
  async getDeployments(namespace?: string): Promise<DeploymentStatus[]> {
    const config = namespace ? { ...this.config, namespace } : this.config;
    const result = await kubectl(['get', 'deployments', '-o', 'json'], config);

    if (result.exitCode !== 0) return [];

    interface K8sDeploymentItem {
      metadata: { name: string; namespace: string; creationTimestamp: string };
      spec: {
        replicas: number;
        template: { spec: { containers: Array<{ image: string }> } };
      };
      status: {
        replicas?: number;
        readyReplicas?: number;
        availableReplicas?: number;
        updatedReplicas?: number;
      };
    }

    const data = parseKubectlJson<{ items: K8sDeploymentItem[] }>(result.stdout);
    if (!data) return [];

    return data.items.map((dep) => ({
      name: dep.metadata.name,
      namespace: dep.metadata.namespace,
      ready: `${dep.status.readyReplicas || 0}/${dep.spec.replicas}`,
      upToDate: dep.status.updatedReplicas || 0,
      available: dep.status.availableReplicas || 0,
      age: this.calculateAge(dep.metadata.creationTimestamp),
      image: dep.spec.template.spec.containers[0]?.image,
      replicas: {
        desired: dep.spec.replicas,
        current: dep.status.replicas || 0,
        ready: dep.status.readyReplicas || 0,
        available: dep.status.availableReplicas || 0,
      },
    }));
  }

  /**
   * Get nodes
   */
  async getNodes(): Promise<NodeStatus[]> {
    const result = await kubectl(['get', 'nodes', '-o', 'json'], this.config);

    if (result.exitCode !== 0) return [];

    interface K8sNodeItem {
      metadata: {
        name: string;
        creationTimestamp: string;
        labels: Record<string, string>;
      };
      spec: Record<string, unknown>;
      status: {
        conditions: Array<{
          type: string;
          status: string;
          reason?: string;
          message?: string;
        }>;
        addresses: Array<{ type: string; address: string }>;
        nodeInfo: { kubeletVersion: string };
        capacity: { cpu: string; memory: string; pods: string };
        allocatable: { cpu: string; memory: string; pods: string };
      };
    }

    const data = parseKubectlJson<{ items: K8sNodeItem[] }>(result.stdout);
    if (!data) return [];

    return data.items.map((node) => {
      const labels = node.metadata.labels || {};
      const roles = Object.keys(labels)
        .filter((k) => k.startsWith('node-role.kubernetes.io/'))
        .map((k) => k.replace('node-role.kubernetes.io/', ''));

      const readyCondition = node.status.conditions.find((c) => c.type === 'Ready');
      const status = readyCondition?.status === 'True' ? 'Ready' : 'NotReady';

      const addresses = node.status.addresses || [];

      return {
        name: node.metadata.name,
        status,
        roles: roles.length > 0 ? roles : ['<none>'],
        age: this.calculateAge(node.metadata.creationTimestamp),
        version: node.status.nodeInfo.kubeletVersion,
        internalIP: addresses.find((a) => a.type === 'InternalIP')?.address,
        externalIP: addresses.find((a) => a.type === 'ExternalIP')?.address,
        conditions: node.status.conditions,
        capacity: node.status.capacity,
        allocatable: node.status.allocatable,
      };
    });
  }

  /**
   * Get events
   */
  async getEvents(namespace?: string, fieldSelector?: string): Promise<KubernetesEvent[]> {
    const args = ['get', 'events', '-o', 'json', '--sort-by=.lastTimestamp'];
    if (fieldSelector) {
      args.push('--field-selector', fieldSelector);
    }

    const config = namespace ? { ...this.config, namespace } : this.config;
    const result = await kubectl(args, config);

    if (result.exitCode !== 0) return [];

    interface K8sEventItem {
      metadata: { namespace: string };
      lastTimestamp?: string;
      type: string;
      reason: string;
      involvedObject: { kind: string; name: string };
      message: string;
    }

    const data = parseKubectlJson<{ items: K8sEventItem[] }>(result.stdout);
    if (!data) return [];

    return data.items.map((event) => ({
      namespace: event.metadata.namespace,
      lastSeen: event.lastTimestamp || 'Unknown',
      type: event.type,
      reason: event.reason,
      object: `${event.involvedObject.kind}/${event.involvedObject.name}`,
      message: event.message,
    }));
  }

  /**
   * Get pod logs
   */
  async getPodLogs(
    podName: string,
    options: {
      namespace?: string;
      container?: string;
      tail?: number;
      since?: string;
      previous?: boolean;
    } = {}
  ): Promise<string> {
    const args = ['logs', podName];

    if (options.container) {
      args.push('-c', options.container);
    }
    if (options.tail) {
      args.push('--tail', options.tail.toString());
    }
    if (options.since) {
      args.push('--since', options.since);
    }
    if (options.previous) {
      args.push('--previous');
    }

    const config = options.namespace
      ? { ...this.config, namespace: options.namespace }
      : this.config;
    const result = await kubectl(args, config);

    return result.stdout;
  }

  /**
   * Describe a resource
   */
  async describe(
    resourceType: KubernetesResourceType,
    name: string,
    namespace?: string
  ): Promise<string> {
    const config = namespace ? { ...this.config, namespace } : this.config;
    const result = await kubectl(['describe', resourceType, name], config);
    return result.stdout || result.stderr;
  }

  /**
   * Get resource as JSON
   */
  async getResource<T = unknown>(
    resourceType: KubernetesResourceType,
    name?: string,
    namespace?: string
  ): Promise<T | null> {
    const args = ['get', resourceType, '-o', 'json'];
    if (name) {
      args.splice(2, 0, name);
    }

    const config = namespace ? { ...this.config, namespace } : this.config;
    const result = await kubectl(args, config);

    if (result.exitCode !== 0) return null;
    return parseKubectlJson<T>(result.stdout);
  }

  /**
   * Scale a deployment
   */
  async scaleDeployment(
    name: string,
    replicas: number,
    namespace?: string
  ): Promise<{ success: boolean; message: string }> {
    const config = namespace ? { ...this.config, namespace } : this.config;
    const result = await kubectl(['scale', 'deployment', name, `--replicas=${replicas}`], config);

    return {
      success: result.exitCode === 0,
      message: result.exitCode === 0 ? result.stdout.trim() : result.stderr.trim(),
    };
  }

  /**
   * Restart a deployment (rollout restart)
   */
  async restartDeployment(
    name: string,
    namespace?: string
  ): Promise<{ success: boolean; message: string }> {
    const config = namespace ? { ...this.config, namespace } : this.config;
    const result = await kubectl(['rollout', 'restart', 'deployment', name], config);

    return {
      success: result.exitCode === 0,
      message: result.exitCode === 0 ? result.stdout.trim() : result.stderr.trim(),
    };
  }

  /**
   * Get rollout status
   */
  async getRolloutStatus(
    name: string,
    namespace?: string
  ): Promise<{ success: boolean; message: string }> {
    const config = namespace ? { ...this.config, namespace } : this.config;
    const result = await kubectl(['rollout', 'status', 'deployment', name, '--timeout=5s'], config);

    return {
      success: result.exitCode === 0,
      message: result.stdout.trim() || result.stderr.trim(),
    };
  }

  /**
   * Rollback a deployment
   */
  async rollbackDeployment(
    name: string,
    revision?: number,
    namespace?: string
  ): Promise<{ success: boolean; message: string }> {
    const args = ['rollout', 'undo', 'deployment', name];
    if (revision) {
      args.push(`--to-revision=${revision}`);
    }

    const config = namespace ? { ...this.config, namespace } : this.config;
    const result = await kubectl(args, config);

    return {
      success: result.exitCode === 0,
      message: result.exitCode === 0 ? result.stdout.trim() : result.stderr.trim(),
    };
  }

  /**
   * Get rollout history
   */
  async getRolloutHistory(name: string, namespace?: string): Promise<string> {
    const config = namespace ? { ...this.config, namespace } : this.config;
    const result = await kubectl(['rollout', 'history', 'deployment', name], config);
    return result.stdout;
  }

  /**
   * Delete a pod (force restart)
   */
  async deletePod(
    name: string,
    namespace?: string,
    gracePeriod?: number
  ): Promise<{ success: boolean; message: string }> {
    const args = ['delete', 'pod', name];
    if (gracePeriod !== undefined) {
      args.push(`--grace-period=${gracePeriod}`);
    }

    const config = namespace ? { ...this.config, namespace } : this.config;
    const result = await kubectl(args, config);

    return {
      success: result.exitCode === 0,
      message: result.exitCode === 0 ? result.stdout.trim() : result.stderr.trim(),
    };
  }

  /**
   * Execute command in pod
   */
  async exec(
    podName: string,
    command: string[],
    options: { namespace?: string; container?: string } = {}
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const args = ['exec', podName, '--'];

    if (options.container) {
      args.splice(2, 0, '-c', options.container);
    }

    args.push(...command);

    const config = options.namespace
      ? { ...this.config, namespace: options.namespace }
      : this.config;
    return kubectl(args, config);
  }

  /**
   * Apply a manifest
   */
  async apply(manifest: string): Promise<{ success: boolean; message: string }> {
    const args = ['apply', '-f', '-'];
    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(
      (resolve) => {
        const cmdArgs = [...args];

        if (this.config.context) {
          cmdArgs.unshift('--context', this.config.context);
        }

        const proc = spawn('kubectl', cmdArgs, {
          env: process.env,
          shell: false,
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('close', (exitCode) => {
          resolve({ stdout, stderr, exitCode: exitCode || 0 });
        });

        proc.stdin.write(manifest);
        proc.stdin.end();
      }
    );

    return {
      success: result.exitCode === 0,
      message: result.exitCode === 0 ? result.stdout.trim() : result.stderr.trim(),
    };
  }

  /**
   * Get cluster info
   */
  async getClusterInfo(): Promise<{ server: string; version: string } | null> {
    const [versionResult, infoResult] = await Promise.all([
      kubectl(['version', '-o', 'json'], this.config),
      kubectl(['cluster-info'], this.config),
    ]);

    if (versionResult.exitCode !== 0) return null;

    interface K8sVersion {
      serverVersion?: { gitVersion: string };
    }

    const version = parseKubectlJson<K8sVersion>(versionResult.stdout);
    const serverMatch = infoResult.stdout.match(
      /Kubernetes (?:control plane|master) is running at (https?:\/\/[^\s]+)/
    );

    return {
      server: serverMatch?.[1] || 'unknown',
      version: version?.serverVersion?.gitVersion || 'unknown',
    };
  }

  /**
   * Get top pods (resource usage)
   */
  async getTopPods(
    namespace?: string
  ): Promise<Array<{ name: string; cpu: string; memory: string }>> {
    const config = namespace ? { ...this.config, namespace } : this.config;
    const result = await kubectl(['top', 'pods', '--no-headers'], config);

    if (result.exitCode !== 0) return [];

    return result.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, cpu, memory] = line.trim().split(/\s+/);
        return { name, cpu, memory };
      });
  }

  /**
   * Get top nodes (resource usage)
   */
  async getTopNodes(): Promise<Array<{ name: string; cpuPercent: string; memoryPercent: string }>> {
    const result = await kubectl(['top', 'nodes', '--no-headers'], this.config);

    if (result.exitCode !== 0) return [];

    return result.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        return {
          name: parts[0],
          cpuPercent: parts[2] || 'N/A',
          memoryPercent: parts[4] || 'N/A',
        };
      });
  }

  /**
   * Calculate age from timestamp
   */
  private calculateAge(timestamp: string): string {
    const created = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - created.getTime();

    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  }
}

/**
 * Create a Kubernetes client
 */
export function createKubernetesClient(config?: KubernetesClientConfig): KubernetesClient {
  return new KubernetesClient(config);
}
