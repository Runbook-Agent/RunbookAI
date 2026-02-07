/**
 * EC2 Tools
 */

import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';

let client: EC2Client | null = null;

function getClient(region?: string): EC2Client {
  if (!client || region) {
    client = new EC2Client({ region: region || process.env.AWS_REGION || 'us-east-1' });
  }
  return client;
}

export interface EC2Instance {
  instanceId: string;
  instanceType: string;
  state: string;
  name: string;
  privateIp: string | undefined;
  publicIp: string | undefined;
  launchTime: Date | undefined;
  tags: Record<string, string>;
}

export async function describeInstances(
  filters?: { name: string; values: string[] }[],
  region?: string
): Promise<EC2Instance[]> {
  const ec2 = getClient(region);

  const command = new DescribeInstancesCommand({
    Filters: filters?.map((f) => ({ Name: f.name, Values: f.values })),
  });

  const response = await ec2.send(command);
  const instances: EC2Instance[] = [];

  for (const reservation of response.Reservations || []) {
    for (const instance of reservation.Instances || []) {
      const tags: Record<string, string> = {};
      for (const tag of instance.Tags || []) {
        if (tag.Key && tag.Value) {
          tags[tag.Key] = tag.Value;
        }
      }

      instances.push({
        instanceId: instance.InstanceId || '',
        instanceType: instance.InstanceType || '',
        state: instance.State?.Name || 'unknown',
        name: tags['Name'] || '',
        privateIp: instance.PrivateIpAddress,
        publicIp: instance.PublicIpAddress,
        launchTime: instance.LaunchTime,
        tags,
      });
    }
  }

  return instances;
}
