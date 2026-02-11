/**
 * Service Configuration
 *
 * Defines the infrastructure services that Runbook should monitor.
 * Users configure which AWS services they use and in which accounts/regions.
 */

import { z } from 'zod';

/**
 * AWS Account configuration
 */
export const AWSAccountSchema = z.object({
  name: z.string().describe('Friendly name for this account (e.g., "production", "staging")'),
  accountId: z.string().optional().describe('AWS Account ID'),
  profile: z.string().optional().describe('AWS CLI profile name'),
  roleArn: z.string().optional().describe('IAM role ARN to assume'),
  externalId: z.string().optional().describe('External ID for assume role'),
  regions: z.array(z.string()).default(['us-east-1']).describe('AWS regions to query'),
  isDefault: z.boolean().default(false).describe('Use as default account'),
});

export type AWSAccount = z.infer<typeof AWSAccountSchema>;

/**
 * Compute service configuration
 */
export const ComputeServiceSchema = z.object({
  type: z.enum(['ecs', 'ec2', 'lambda', 'eks', 'fargate', 'apprunner', 'amplify', 'lightsail']),
  enabled: z.boolean().default(true),
  // Optional filters to limit scope
  clusters: z.array(z.string()).optional().describe('ECS/EKS cluster names to monitor'),
  services: z.array(z.string()).optional().describe('Specific service names to monitor'),
  functions: z.array(z.string()).optional().describe('Lambda function name patterns'),
  tags: z.record(z.string()).optional().describe('Filter by resource tags'),
});

export type ComputeService = z.infer<typeof ComputeServiceSchema>;

/**
 * Database service configuration
 */
export const DatabaseServiceSchema = z.object({
  type: z.enum(['rds', 'dynamodb', 'elasticache', 'documentdb', 'neptune', 'redshift', 'aurora']),
  enabled: z.boolean().default(true),
  instances: z.array(z.string()).optional().describe('Specific instance/table names'),
  tags: z.record(z.string()).optional(),
});

export type DatabaseService = z.infer<typeof DatabaseServiceSchema>;

/**
 * Storage service configuration
 */
export const StorageServiceSchema = z.object({
  type: z.enum(['s3', 'efs', 'fsx']),
  enabled: z.boolean().default(true),
  buckets: z.array(z.string()).optional().describe('Specific bucket names'),
  tags: z.record(z.string()).optional(),
});

export type StorageService = z.infer<typeof StorageServiceSchema>;

/**
 * Networking service configuration
 */
export const NetworkServiceSchema = z.object({
  type: z.enum(['alb', 'nlb', 'cloudfront', 'apigateway', 'route53', 'vpc']),
  enabled: z.boolean().default(true),
  loadBalancers: z.array(z.string()).optional(),
  distributions: z.array(z.string()).optional(),
  apis: z.array(z.string()).optional(),
  tags: z.record(z.string()).optional(),
});

export type NetworkService = z.infer<typeof NetworkServiceSchema>;

/**
 * Observability configuration
 */
export const ObservabilitySchema = z.object({
  cloudwatch: z
    .object({
      enabled: z.boolean().default(true),
      logGroups: z.array(z.string()).optional().describe('Log group name patterns to search'),
      alarmPrefixes: z.array(z.string()).optional().describe('Alarm name prefixes to monitor'),
    })
    .default({}),
  xray: z
    .object({
      enabled: z.boolean().default(false),
    })
    .default({}),
  // Third-party
  datadog: z
    .object({
      enabled: z.boolean().default(false),
      apiKey: z.string().optional(),
      appKey: z.string().optional(),
      site: z.string().default('datadoghq.com'),
    })
    .default({}),
});

export type Observability = z.infer<typeof ObservabilitySchema>;

/**
 * Full service configuration
 */
export const ServiceConfigSchema = z.object({
  version: z.literal(1),

  // AWS accounts
  aws: z
    .object({
      accounts: z.array(AWSAccountSchema).default([]),
      defaultRegion: z.string().default('us-east-1'),
    })
    .default({}),

  // Services by category
  compute: z.array(ComputeServiceSchema).default([]),
  databases: z.array(DatabaseServiceSchema).default([]),
  storage: z.array(StorageServiceSchema).default([]),
  networking: z.array(NetworkServiceSchema).default([]),

  // Observability
  observability: ObservabilitySchema.default({}),

  // Incident management
  incidents: z
    .object({
      pagerduty: z
        .object({
          enabled: z.boolean().default(false),
          apiKey: z.string().optional(),
          defaultEmail: z.string().optional().describe('Email for PagerDuty API calls'),
        })
        .default({}),
      opsgenie: z
        .object({
          enabled: z.boolean().default(false),
          apiKey: z.string().optional(),
        })
        .default({}),
    })
    .default({}),

  // Custom services (for non-AWS or custom integrations)
  custom: z
    .array(
      z.object({
        name: z.string(),
        type: z.string(),
        endpoint: z.string().optional(),
        healthCheck: z.string().optional(),
        tags: z.record(z.string()).optional(),
      })
    )
    .default([]),
});

export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;

/**
 * Default configuration for new users
 */
export const DEFAULT_SERVICE_CONFIG: ServiceConfig = {
  version: 1,
  aws: {
    accounts: [],
    defaultRegion: 'us-east-1',
  },
  compute: [],
  databases: [],
  storage: [],
  networking: [],
  observability: {
    cloudwatch: { enabled: true },
    xray: { enabled: false },
    datadog: { enabled: false, site: 'datadoghq.com' },
  },
  incidents: {
    pagerduty: { enabled: false },
    opsgenie: { enabled: false },
  },
  custom: [],
};

/**
 * Example configurations for different setups
 */
export const EXAMPLE_CONFIGS = {
  // Simple ECS + RDS setup
  ecsRds: {
    version: 1 as const,
    aws: {
      accounts: [{ name: 'production', regions: ['us-east-1'], isDefault: true }],
      defaultRegion: 'us-east-1',
    },
    compute: [{ type: 'ecs' as const, enabled: true }],
    databases: [{ type: 'rds' as const, enabled: true }],
    storage: [],
    networking: [{ type: 'alb' as const, enabled: true }],
    observability: {
      cloudwatch: { enabled: true },
      xray: { enabled: false },
      datadog: { enabled: false, site: 'datadoghq.com' },
    },
    incidents: { pagerduty: { enabled: false }, opsgenie: { enabled: false } },
    custom: [],
  },

  // Serverless setup
  serverless: {
    version: 1 as const,
    aws: {
      accounts: [{ name: 'production', regions: ['us-east-1'], isDefault: true }],
      defaultRegion: 'us-east-1',
    },
    compute: [{ type: 'lambda' as const, enabled: true }],
    databases: [{ type: 'dynamodb' as const, enabled: true }],
    storage: [{ type: 's3' as const, enabled: true }],
    networking: [{ type: 'apigateway' as const, enabled: true }],
    observability: {
      cloudwatch: { enabled: true },
      xray: { enabled: true },
      datadog: { enabled: false, site: 'datadoghq.com' },
    },
    incidents: { pagerduty: { enabled: false }, opsgenie: { enabled: false } },
    custom: [],
  },

  // Multi-account enterprise
  enterprise: {
    version: 1 as const,
    aws: {
      accounts: [
        {
          name: 'production',
          accountId: '111111111111',
          roleArn: 'arn:aws:iam::111111111111:role/RunbookAccess',
          regions: ['us-east-1', 'us-west-2'],
          isDefault: true as const,
        },
        {
          name: 'staging',
          accountId: '222222222222',
          roleArn: 'arn:aws:iam::222222222222:role/RunbookAccess',
          regions: ['us-east-1'],
          isDefault: false as const,
        },
      ],
      defaultRegion: 'us-east-1',
    },
    compute: [
      { type: 'ecs' as const, enabled: true },
      { type: 'eks' as const, enabled: true },
    ],
    databases: [
      { type: 'rds' as const, enabled: true },
      { type: 'elasticache' as const, enabled: true },
    ],
    storage: [{ type: 's3' as const, enabled: true }],
    networking: [
      { type: 'alb' as const, enabled: true },
      { type: 'cloudfront' as const, enabled: true },
    ],
    observability: {
      cloudwatch: { enabled: true },
      xray: { enabled: false },
      datadog: { enabled: true, site: 'datadoghq.com' },
    },
    incidents: { pagerduty: { enabled: true }, opsgenie: { enabled: false } },
    custom: [],
  },
};
