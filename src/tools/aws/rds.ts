/**
 * RDS Tools
 */

import {
  RDSClient,
  DescribeDBInstancesCommand,
  DescribeDBClustersCommand,
} from '@aws-sdk/client-rds';

let client: RDSClient | null = null;

function getClient(region?: string): RDSClient {
  if (!client || region) {
    client = new RDSClient({ region: region || process.env.AWS_REGION || 'us-east-1' });
  }
  return client;
}

export interface RDSInstance {
  dbInstanceIdentifier: string;
  dbInstanceClass: string;
  engine: string;
  engineVersion: string;
  dbInstanceStatus: string;
  endpoint: string | undefined;
  port: number | undefined;
  allocatedStorage: number;
  multiAZ: boolean;
  availabilityZone: string | undefined;
}

export interface RDSCluster {
  dbClusterIdentifier: string;
  engine: string;
  engineVersion: string;
  status: string;
  endpoint: string | undefined;
  readerEndpoint: string | undefined;
  port: number | undefined;
  multiAZ: boolean;
  members: number;
}

export async function describeDBInstances(
  dbInstanceIdentifier?: string,
  region?: string
): Promise<RDSInstance[]> {
  const rds = getClient(region);

  const command = new DescribeDBInstancesCommand({
    DBInstanceIdentifier: dbInstanceIdentifier,
  });

  const response = await rds.send(command);

  return (response.DBInstances || []).map((db) => ({
    dbInstanceIdentifier: db.DBInstanceIdentifier || '',
    dbInstanceClass: db.DBInstanceClass || '',
    engine: db.Engine || '',
    engineVersion: db.EngineVersion || '',
    dbInstanceStatus: db.DBInstanceStatus || '',
    endpoint: db.Endpoint?.Address,
    port: db.Endpoint?.Port,
    allocatedStorage: db.AllocatedStorage || 0,
    multiAZ: db.MultiAZ || false,
    availabilityZone: db.AvailabilityZone,
  }));
}

export async function describeDBClusters(
  dbClusterIdentifier?: string,
  region?: string
): Promise<RDSCluster[]> {
  const rds = getClient(region);

  const command = new DescribeDBClustersCommand({
    DBClusterIdentifier: dbClusterIdentifier,
  });

  const response = await rds.send(command);

  return (response.DBClusters || []).map((cluster) => ({
    dbClusterIdentifier: cluster.DBClusterIdentifier || '',
    engine: cluster.Engine || '',
    engineVersion: cluster.EngineVersion || '',
    status: cluster.Status || '',
    endpoint: cluster.Endpoint,
    readerEndpoint: cluster.ReaderEndpoint,
    port: cluster.Port,
    multiAZ: cluster.MultiAZ || false,
    members: cluster.DBClusterMembers?.length || 0,
  }));
}
