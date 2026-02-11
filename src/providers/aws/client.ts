/**
 * AWS Client Manager
 *
 * Manages AWS SDK clients with multi-account and multi-region support.
 * Uses service configuration to determine which accounts/regions to query.
 */

import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { fromIni } from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import type { AWSAccount } from '../../config/services';
import { loadServiceConfig } from '../../config/onboarding';

interface ClientCacheKey {
  accountName: string;
  region: string;
  service: string;
}

// Cache for AWS clients
const clientCache = new Map<string, unknown>();
const credentialCache = new Map<string, AwsCredentialIdentity>();

/**
 * Get credentials for an AWS account
 */
async function getCredentials(
  account: AWSAccount,
  region: string
): Promise<AwsCredentialIdentity | undefined> {
  const cacheKey = `${account.name}:${region}`;

  if (credentialCache.has(cacheKey)) {
    return credentialCache.get(cacheKey);
  }

  let credentials: AwsCredentialIdentity | undefined;

  // Option 1: Assume role
  if (account.roleArn) {
    const sts = new STSClient({ region });
    const command = new AssumeRoleCommand({
      RoleArn: account.roleArn,
      RoleSessionName: 'runbook-session',
      ExternalId: account.externalId,
      DurationSeconds: 3600,
    });

    const response = await sts.send(command);

    if (response.Credentials) {
      credentials = {
        accessKeyId: response.Credentials.AccessKeyId!,
        secretAccessKey: response.Credentials.SecretAccessKey!,
        sessionToken: response.Credentials.SessionToken,
        expiration: response.Credentials.Expiration,
      };
    }
  }
  // Option 2: Use named profile
  else if (account.profile) {
    const provider = fromIni({ profile: account.profile });
    credentials = await provider();
  }
  // Option 3: Use default credentials (env vars or default profile)
  // No action needed - SDK will use default credential chain

  if (credentials) {
    credentialCache.set(cacheKey, credentials);
  }

  return credentials;
}

/**
 * Get or create a cached AWS client
 */
export async function getClient<T>(
  ClientClass: new (config: { region: string; credentials?: AwsCredentialIdentity }) => T,
  options: {
    accountName?: string;
    region?: string;
  } = {}
): Promise<T> {
  // Load service config
  const config = await loadServiceConfig();

  // Determine which account to use
  let account: AWSAccount | undefined;
  if (options.accountName && config?.aws.accounts) {
    account = config.aws.accounts.find((a) => a.name === options.accountName);
  } else if (config?.aws.accounts) {
    account = config.aws.accounts.find((a) => a.isDefault) || config.aws.accounts[0];
  }

  // Determine region
  const region =
    options.region ||
    account?.regions[0] ||
    config?.aws.defaultRegion ||
    process.env.AWS_REGION ||
    'us-east-1';

  // Cache key
  const cacheKey = `${ClientClass.name}:${account?.name || 'default'}:${region}`;

  if (clientCache.has(cacheKey)) {
    return clientCache.get(cacheKey) as T;
  }

  // Get credentials if account is configured
  let credentials: AwsCredentialIdentity | undefined;
  if (account) {
    credentials = await getCredentials(account, region);
  }

  // Create client
  const client = new ClientClass({ region, credentials });
  clientCache.set(cacheKey, client);

  return client;
}

/**
 * Get all configured accounts
 */
export async function getConfiguredAccounts(): Promise<AWSAccount[]> {
  const config = await loadServiceConfig();
  return config?.aws.accounts || [];
}

/**
 * Get regions for an account
 */
export async function getAccountRegions(accountName?: string): Promise<string[]> {
  const config = await loadServiceConfig();

  if (!config?.aws.accounts || config.aws.accounts.length === 0) {
    return [config?.aws.defaultRegion || process.env.AWS_REGION || 'us-east-1'];
  }

  let account: AWSAccount | undefined;
  if (accountName) {
    account = config.aws.accounts.find((a) => a.name === accountName);
  } else {
    account = config.aws.accounts.find((a) => a.isDefault) || config.aws.accounts[0];
  }

  return account?.regions || [config.aws.defaultRegion];
}

/**
 * Check which services are enabled
 */
export async function getEnabledServices(): Promise<{
  compute: string[];
  databases: string[];
  storage: string[];
  networking: string[];
}> {
  const config = await loadServiceConfig();

  return {
    compute: config?.compute.filter((s) => s.enabled).map((s) => s.type) || [],
    databases: config?.databases.filter((s) => s.enabled).map((s) => s.type) || [],
    storage: config?.storage.filter((s) => s.enabled).map((s) => s.type) || [],
    networking: config?.networking.filter((s) => s.enabled).map((s) => s.type) || [],
  };
}

/**
 * Clear credential and client caches
 */
export function clearCaches(): void {
  clientCache.clear();
  credentialCache.clear();
}
