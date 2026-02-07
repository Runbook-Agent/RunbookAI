/**
 * Cost Analysis Skill
 *
 * Analyze AWS spending and identify optimization opportunities.
 */

import type { SkillDefinition } from '../types';

export const costAnalysisSkill: SkillDefinition = {
  id: 'cost-analysis',
  name: 'Cost Analysis',
  description: 'Analyze AWS resource usage and identify cost optimization opportunities',
  version: '1.0.0',
  tags: ['cost', 'optimization', 'finops', 'analysis'],
  riskLevel: 'low',

  parameters: [
    {
      name: 'scope',
      description: 'Scope of analysis: all, compute, database, storage, or specific service',
      type: 'string',
      required: false,
      default: 'all',
    },
    {
      name: 'include_recommendations',
      description: 'Include optimization recommendations',
      type: 'boolean',
      required: false,
      default: true,
    },
  ],

  steps: [
    {
      id: 'inventory_compute',
      name: 'Inventory Compute Resources',
      description: 'List all compute resources (EC2, ECS, Lambda, EKS)',
      action: 'aws_query',
      parameters: {
        query: 'List all compute resources with their configurations',
        services: ['ec2', 'ecs', 'lambda', 'eks'],
      },
      onError: 'continue',
    },
    {
      id: 'inventory_databases',
      name: 'Inventory Database Resources',
      description: 'List all database resources (RDS, DynamoDB, ElastiCache)',
      action: 'aws_query',
      parameters: {
        query: 'List all database resources with their configurations',
        services: ['rds', 'dynamodb', 'elasticache'],
      },
      onError: 'continue',
    },
    {
      id: 'inventory_storage',
      name: 'Inventory Storage Resources',
      description: 'List all storage resources (S3, EFS, EBS)',
      action: 'aws_query',
      parameters: {
        query: 'List all storage resources',
        services: ['s3', 'efs'],
      },
      onError: 'continue',
    },
    {
      id: 'check_idle_resources',
      name: 'Check for Idle Resources',
      description: 'Look for resources with low utilization',
      action: 'datadog',
      parameters: {
        action: 'metrics',
        query: 'avg:aws.ec2.cpuutilization{*} by {instance_id}',
        from_minutes: 1440, // 24 hours
      },
      onError: 'continue',
    },
    {
      id: 'analyze_compute',
      name: 'Analyze Compute Costs',
      description: 'Identify compute optimization opportunities',
      action: 'prompt',
      parameters: {
        instruction: `Analyze the compute resources:
{{steps.inventory_compute.result}}

Identify:
1. Over-provisioned instances (too much CPU/memory)
2. Idle or underutilized resources
3. Resources that could use Spot/Reserved instances
4. Lambda functions with suboptimal memory settings
5. ECS services with excess capacity

For each, estimate potential savings.`,
      },
    },
    {
      id: 'analyze_databases',
      name: 'Analyze Database Costs',
      description: 'Identify database optimization opportunities',
      action: 'prompt',
      parameters: {
        instruction: `Analyze the database resources:
{{steps.inventory_databases.result}}

Identify:
1. Over-provisioned database instances
2. Databases that could use Reserved Instances
3. DynamoDB tables with provisioned capacity that could use on-demand
4. Read replicas that may not be needed
5. ElastiCache clusters with excess nodes

For each, estimate potential savings.`,
      },
    },
    {
      id: 'analyze_storage',
      name: 'Analyze Storage Costs',
      description: 'Identify storage optimization opportunities',
      action: 'prompt',
      parameters: {
        instruction: `Analyze the storage resources:
{{steps.inventory_storage.result}}

Identify:
1. S3 buckets that could use lifecycle policies
2. Data that could move to cheaper storage classes (Glacier, IA)
3. EFS file systems with suboptimal throughput mode
4. Orphaned EBS volumes or snapshots

For each, estimate potential savings.`,
      },
    },
    {
      id: 'generate_report',
      name: 'Generate Cost Report',
      description: 'Create comprehensive cost analysis report',
      action: 'prompt',
      parameters: {
        instruction: `Create a cost optimization report:

## Executive Summary
Brief overview of findings and total potential savings

## Compute Optimization
{{steps.analyze_compute.result}}

## Database Optimization
{{steps.analyze_databases.result}}

## Storage Optimization
{{steps.analyze_storage.result}}

## Priority Recommendations
Top 5 actions ordered by impact and ease of implementation

## Implementation Plan
Suggested timeline and approach for implementing changes

## Risks
Any risks or considerations for each recommendation`,
      },
    },
  ],
};
