/**
 * ECS Tools
 */

import {
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
  DescribeTasksCommand,
  ListTasksCommand,
} from '@aws-sdk/client-ecs';

let client: ECSClient | null = null;

function getClient(region?: string): ECSClient {
  if (!client || region) {
    client = new ECSClient({ region: region || process.env.AWS_REGION || 'us-east-1' });
  }
  return client;
}

export interface ECSCluster {
  clusterArn: string;
  clusterName: string;
}

export interface ECSService {
  serviceName: string;
  clusterArn: string;
  status: string;
  desiredCount: number;
  runningCount: number;
  pendingCount: number;
  taskDefinition: string;
  launchType: string;
}

export interface ECSTask {
  taskArn: string;
  taskDefinitionArn: string;
  lastStatus: string;
  desiredStatus: string;
  cpu: string | undefined;
  memory: string | undefined;
  startedAt: Date | undefined;
}

export async function listClusters(region?: string): Promise<ECSCluster[]> {
  const ecs = getClient(region);
  const command = new ListClustersCommand({});
  const response = await ecs.send(command);

  return (response.clusterArns || []).map((arn) => ({
    clusterArn: arn,
    clusterName: arn.split('/').pop() || '',
  }));
}

export async function listServices(clusterArn: string, region?: string): Promise<string[]> {
  const ecs = getClient(region);
  const command = new ListServicesCommand({ cluster: clusterArn });
  const response = await ecs.send(command);
  return response.serviceArns || [];
}

export async function describeServices(
  clusterArn: string,
  serviceArns: string[],
  region?: string
): Promise<ECSService[]> {
  if (serviceArns.length === 0) return [];

  const ecs = getClient(region);
  const command = new DescribeServicesCommand({
    cluster: clusterArn,
    services: serviceArns,
  });
  const response = await ecs.send(command);

  return (response.services || []).map((svc) => ({
    serviceName: svc.serviceName || '',
    clusterArn: svc.clusterArn || '',
    status: svc.status || '',
    desiredCount: svc.desiredCount || 0,
    runningCount: svc.runningCount || 0,
    pendingCount: svc.pendingCount || 0,
    taskDefinition: svc.taskDefinition || '',
    launchType: svc.launchType || 'EC2',
  }));
}

export async function listTasks(clusterArn: string, serviceName?: string, region?: string): Promise<string[]> {
  const ecs = getClient(region);
  const command = new ListTasksCommand({
    cluster: clusterArn,
    serviceName,
  });
  const response = await ecs.send(command);
  return response.taskArns || [];
}

export async function describeTasks(clusterArn: string, taskArns: string[], region?: string): Promise<ECSTask[]> {
  if (taskArns.length === 0) return [];

  const ecs = getClient(region);
  const command = new DescribeTasksCommand({
    cluster: clusterArn,
    tasks: taskArns,
  });
  const response = await ecs.send(command);

  return (response.tasks || []).map((task) => ({
    taskArn: task.taskArn || '',
    taskDefinitionArn: task.taskDefinitionArn || '',
    lastStatus: task.lastStatus || '',
    desiredStatus: task.desiredStatus || '',
    cpu: task.cpu,
    memory: task.memory,
    startedAt: task.startedAt,
  }));
}

export async function getAllServicesWithStatus(region?: string): Promise<ECSService[]> {
  const clusters = await listClusters(region);
  const allServices: ECSService[] = [];

  for (const cluster of clusters) {
    const serviceArns = await listServices(cluster.clusterArn, region);
    if (serviceArns.length > 0) {
      // DescribeServices can only handle 10 services at a time
      for (let i = 0; i < serviceArns.length; i += 10) {
        const batch = serviceArns.slice(i, i + 10);
        const services = await describeServices(cluster.clusterArn, batch, region);
        allServices.push(...services);
      }
    }
  }

  return allServices;
}
