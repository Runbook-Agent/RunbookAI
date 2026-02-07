/**
 * Security Audit Skill
 *
 * Perform security review of AWS resources and IAM configuration.
 */

import type { SkillDefinition } from '../types';

export const securityAuditSkill: SkillDefinition = {
  id: 'security-audit',
  name: 'Security Audit',
  description: 'Perform security review of AWS resources, IAM policies, and configurations',
  version: '1.0.0',
  tags: ['security', 'audit', 'compliance', 'iam'],
  riskLevel: 'low',

  parameters: [
    {
      name: 'scope',
      description: 'Scope: all, iam, network, data, compute',
      type: 'string',
      required: false,
      default: 'all',
    },
    {
      name: 'service',
      description: 'Specific service to audit (optional)',
      type: 'string',
      required: false,
    },
    {
      name: 'compliance_framework',
      description: 'Compliance framework to check against: soc2, hipaa, pci, cis',
      type: 'string',
      required: false,
    },
  ],

  steps: [
    {
      id: 'audit_iam',
      name: 'Audit IAM Configuration',
      description: 'Review IAM roles, policies, and permissions',
      action: 'aws_query',
      parameters: {
        query: 'List all IAM roles and their policies',
        services: ['iam'],
      },
      onError: 'continue',
    },
    {
      id: 'audit_secrets',
      name: 'Audit Secrets Management',
      description: 'Review secrets and their rotation status',
      action: 'aws_query',
      parameters: {
        query: 'List all secrets and their rotation configuration',
        services: ['secretsmanager'],
      },
      onError: 'continue',
    },
    {
      id: 'audit_encryption',
      name: 'Audit Encryption',
      description: 'Review KMS keys and encryption settings',
      action: 'aws_query',
      parameters: {
        query: 'List KMS keys and their usage',
        services: ['kms'],
      },
      onError: 'continue',
    },
    {
      id: 'audit_network',
      name: 'Audit Network Security',
      description: 'Review VPCs, security groups, and network ACLs',
      action: 'aws_query',
      parameters: {
        query: 'List VPCs and security groups',
        services: ['vpc', 'elb'],
      },
      onError: 'continue',
    },
    {
      id: 'audit_waf',
      name: 'Audit WAF Configuration',
      description: 'Review Web Application Firewall rules',
      action: 'aws_query',
      parameters: {
        query: 'List WAF web ACLs and rules',
        services: ['waf'],
      },
      onError: 'continue',
    },
    {
      id: 'audit_certificates',
      name: 'Audit SSL/TLS Certificates',
      description: 'Check certificate validity and expiration',
      action: 'aws_query',
      parameters: {
        query: 'List all ACM certificates and their status',
        services: ['acm'],
      },
      onError: 'continue',
    },
    {
      id: 'audit_storage',
      name: 'Audit Storage Security',
      description: 'Check S3 bucket policies and encryption',
      action: 'aws_query',
      parameters: {
        query: 'List S3 buckets with their access settings',
        services: ['s3'],
      },
      onError: 'continue',
    },
    {
      id: 'audit_databases',
      name: 'Audit Database Security',
      description: 'Check database encryption and access',
      action: 'aws_query',
      parameters: {
        query: 'List databases with their security configuration',
        services: ['rds', 'dynamodb'],
      },
      onError: 'continue',
    },
    {
      id: 'analyze_iam_findings',
      name: 'Analyze IAM Findings',
      description: 'Identify IAM security issues',
      action: 'prompt',
      parameters: {
        instruction: `Analyze IAM configuration:
{{steps.audit_iam.result}}

Check for:
1. Overly permissive policies (*, Admin access)
2. Unused roles or policies
3. Roles without MFA requirement
4. Cross-account access without external ID
5. Policies allowing public access
6. Long-lived access keys

Flag severity: CRITICAL, HIGH, MEDIUM, LOW`,
      },
    },
    {
      id: 'analyze_network_findings',
      name: 'Analyze Network Findings',
      description: 'Identify network security issues',
      action: 'prompt',
      parameters: {
        instruction: `Analyze network configuration:
{{steps.audit_network.result}}
{{steps.audit_waf.result}}

Check for:
1. Security groups with 0.0.0.0/0 ingress
2. SSH/RDP open to the internet
3. Databases accessible from internet
4. Missing WAF rules
5. Unencrypted load balancers
6. VPC flow logs disabled

Flag severity: CRITICAL, HIGH, MEDIUM, LOW`,
      },
    },
    {
      id: 'analyze_data_findings',
      name: 'Analyze Data Security Findings',
      description: 'Identify data security issues',
      action: 'prompt',
      parameters: {
        instruction: `Analyze data security:
{{steps.audit_storage.result}}
{{steps.audit_databases.result}}
{{steps.audit_encryption.result}}
{{steps.audit_secrets.result}}

Check for:
1. Unencrypted S3 buckets
2. Public S3 buckets
3. Unencrypted databases
4. Secrets without rotation
5. KMS keys without rotation
6. Backups not encrypted

Flag severity: CRITICAL, HIGH, MEDIUM, LOW`,
      },
    },
    {
      id: 'check_certificates',
      name: 'Check Certificate Status',
      description: 'Identify certificate issues',
      action: 'prompt',
      parameters: {
        instruction: `Analyze certificates:
{{steps.audit_certificates.result}}

Check for:
1. Certificates expiring within 30 days
2. Certificates using weak algorithms
3. Certificates not auto-renewed
4. Unused certificates

Flag severity: CRITICAL, HIGH, MEDIUM, LOW`,
      },
    },
    {
      id: 'generate_report',
      name: 'Generate Security Report',
      description: 'Create comprehensive security audit report',
      action: 'prompt',
      parameters: {
        instruction: `Create a security audit report:

## Executive Summary
Overall security posture and critical findings count

## Critical Findings
Issues requiring immediate attention

## High Priority Findings
Issues to address within 1 week

## Medium Priority Findings
Issues to address within 1 month

## Low Priority Findings
Best practices and improvements

## IAM Security
{{steps.analyze_iam_findings.result}}

## Network Security
{{steps.analyze_network_findings.result}}

## Data Security
{{steps.analyze_data_findings.result}}

## Certificate Status
{{steps.check_certificates.result}}

## Remediation Plan
Prioritized list of actions with effort estimates

## Compliance Status
{{#if compliance_framework}}
Status against {{compliance_framework}} requirements
{{/if}}`,
      },
    },
  ],
};
