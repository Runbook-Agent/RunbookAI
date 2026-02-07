/**
 * Approval Flow
 *
 * Handles user confirmation for state-changing operations (mutations).
 * Provides CLI prompts for approval and maintains an audit trail.
 * Supports Slack integration for remote approval.
 */

import { createInterface } from 'readline';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  isSlackConfigured,
  requestSlackApproval as sendSlackApproval,
  getConfiguredDefaultChannel,
} from '../tools/incident/slack';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface MutationRequest {
  id: string;
  operation: string;
  resource: string;
  description: string;
  riskLevel: RiskLevel;
  parameters: Record<string, unknown>;
  rollbackCommand?: string;
  estimatedImpact?: string;
}

export interface ApprovalResult {
  approved: boolean;
  approvedAt?: Date;
  approvedBy?: string;
  reason?: string;
}

export interface ApprovalAuditEntry {
  timestamp: string;
  mutationId: string;
  operation: string;
  resource: string;
  riskLevel: RiskLevel;
  approved: boolean;
  reason?: string;
}

/**
 * Risk level descriptions for user display
 */
export const RISK_DESCRIPTIONS: Record<RiskLevel, string> = {
  low: 'Low risk - easily reversible, minimal impact',
  medium: 'Medium risk - may affect service briefly',
  high: 'High risk - may cause service disruption',
  critical: 'Critical risk - may cause significant downtime or data loss',
};

/**
 * Risk level colors for CLI display
 */
export const RISK_COLORS: Record<RiskLevel, string> = {
  low: '\x1b[32m',      // green
  medium: '\x1b[33m',   // yellow
  high: '\x1b[91m',     // light red
  critical: '\x1b[31m', // red
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

/**
 * Classify risk level based on operation type
 */
export function classifyRisk(operation: string, resource: string): RiskLevel {
  const op = operation.toLowerCase();
  const res = resource.toLowerCase();

  // Critical operations
  if (op.includes('delete') || op.includes('terminate') || op.includes('destroy')) {
    return 'critical';
  }
  if (op.includes('truncate') || op.includes('drop')) {
    return 'critical';
  }
  if (res.includes('production') || res.includes('prod')) {
    if (op.includes('update') || op.includes('modify')) {
      return 'high';
    }
  }

  // High risk operations
  if (op.includes('restart') || op.includes('reboot') || op.includes('stop')) {
    return 'high';
  }
  if (op.includes('scale') && res.includes('down')) {
    return 'high';
  }
  if (op.includes('deploy') || op.includes('update-service')) {
    return 'high';
  }

  // Medium risk operations
  if (op.includes('update') || op.includes('modify') || op.includes('change')) {
    return 'medium';
  }
  if (op.includes('scale')) {
    return 'medium';
  }

  // Default to low
  return 'low';
}

/**
 * Format mutation request for display
 */
export function formatMutationRequest(request: MutationRequest): string {
  const riskColor = RISK_COLORS[request.riskLevel];
  const lines = [
    '',
    `${BOLD}═══════════════════════════════════════════════════════════════${RESET}`,
    `${BOLD}  MUTATION APPROVAL REQUIRED${RESET}`,
    `${BOLD}═══════════════════════════════════════════════════════════════${RESET}`,
    '',
    `  ${BOLD}Operation:${RESET}    ${request.operation}`,
    `  ${BOLD}Resource:${RESET}     ${request.resource}`,
    `  ${BOLD}Risk Level:${RESET}   ${riskColor}${request.riskLevel.toUpperCase()}${RESET}`,
    `                ${RISK_DESCRIPTIONS[request.riskLevel]}`,
    '',
    `  ${BOLD}Description:${RESET}`,
    `    ${request.description}`,
    '',
  ];

  if (request.estimatedImpact) {
    lines.push(`  ${BOLD}Estimated Impact:${RESET}`);
    lines.push(`    ${request.estimatedImpact}`);
    lines.push('');
  }

  if (Object.keys(request.parameters).length > 0) {
    lines.push(`  ${BOLD}Parameters:${RESET}`);
    for (const [key, value] of Object.entries(request.parameters)) {
      lines.push(`    ${key}: ${JSON.stringify(value)}`);
    }
    lines.push('');
  }

  if (request.rollbackCommand) {
    lines.push(`  ${BOLD}Rollback Command:${RESET}`);
    lines.push(`    ${request.rollbackCommand}`);
    lines.push('');
  }

  lines.push(`${BOLD}═══════════════════════════════════════════════════════════════${RESET}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Request approval via CLI prompt
 */
export async function requestApproval(request: MutationRequest): Promise<ApprovalResult> {
  // Display the request
  console.log(formatMutationRequest(request));

  // For critical operations, require typing 'yes' explicitly
  const promptMessage = request.riskLevel === 'critical'
    ? `Type 'yes' to approve, or 'no' to reject: `
    : `Approve this operation? (y/n): `;

  const response = await prompt(promptMessage);
  const normalizedResponse = response.toLowerCase().trim();

  let approved = false;
  if (request.riskLevel === 'critical') {
    approved = normalizedResponse === 'yes';
  } else {
    approved = normalizedResponse === 'y' || normalizedResponse === 'yes';
  }

  // Log to audit trail
  await logApproval(request, approved);

  return {
    approved,
    approvedAt: approved ? new Date() : undefined,
    approvedBy: process.env.USER || 'unknown',
    reason: approved ? undefined : 'User rejected',
  };
}

/**
 * Simple CLI prompt
 */
function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}


/**
 * Check if auto-approval is allowed for an operation
 */
export function canAutoApprove(riskLevel: RiskLevel, config?: { autoApprove?: RiskLevel[] }): boolean {
  const autoApproveLevels = config?.autoApprove || [];
  return autoApproveLevels.includes(riskLevel);
}

/**
 * Mutation cooldown tracker
 */
const recentMutations: Map<string, Date> = new Map();

/**
 * Check if enough time has passed since the last critical mutation
 */
export function checkCooldown(
  operation: string,
  cooldownMs: number = 60000
): { allowed: boolean; remainingMs: number } {
  const lastMutation = recentMutations.get('critical');

  if (!lastMutation) {
    return { allowed: true, remainingMs: 0 };
  }

  const elapsed = Date.now() - lastMutation.getTime();
  if (elapsed >= cooldownMs) {
    return { allowed: true, remainingMs: 0 };
  }

  return { allowed: false, remainingMs: cooldownMs - elapsed };
}

/**
 * Record a critical mutation for cooldown tracking
 */
export function recordCriticalMutation(): void {
  recentMutations.set('critical', new Date());
}

/**
 * Generate a unique mutation ID
 */
export function generateMutationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `mut_${timestamp}_${random}`;
}

/**
 * Approval options
 */
export interface ApprovalOptions {
  /** Use Slack for approval instead of CLI */
  useSlack?: boolean;
  /** Slack channel for approval (defaults to configured channel) */
  slackChannel?: string;
  /** Timeout for Slack approval in milliseconds (default: 5 minutes) */
  slackTimeout?: number;
  /** Auto-approve for certain risk levels */
  autoApprove?: RiskLevel[];
}

/**
 * Request approval with optional Slack integration
 */
export async function requestApprovalWithOptions(
  request: MutationRequest,
  options: ApprovalOptions = {}
): Promise<ApprovalResult> {
  // Check if auto-approval is allowed
  if (options.autoApprove && options.autoApprove.includes(request.riskLevel)) {
    await logApproval(request, true, 'auto-approved');
    return {
      approved: true,
      approvedAt: new Date(),
      approvedBy: 'auto-approval',
      reason: 'Auto-approved based on risk level',
    };
  }

  // Use Slack if configured and requested
  if (options.useSlack && isSlackConfigured()) {
    return requestSlackApproval(request, options.slackChannel, options.slackTimeout);
  }

  // Fall back to CLI
  return requestApproval(request);
}

/**
 * Request approval via Slack
 *
 * Note: This sends a message with approval buttons. For full button interaction,
 * a webhook server is needed to handle the button clicks. This implementation
 * polls for a response file as a simple workaround.
 */
async function requestSlackApproval(
  request: MutationRequest,
  channel?: string,
  timeout: number = 300000 // 5 minutes default
): Promise<ApprovalResult> {
  const slackChannel = channel || getConfiguredDefaultChannel();

  if (!slackChannel) {
    console.log('\x1b[33mNo Slack channel configured. Falling back to CLI approval.\x1b[0m');
    return requestApproval(request);
  }

  try {
    // Send approval request to Slack
    const message = await sendSlackApproval(slackChannel, {
      id: request.id,
      operation: request.operation,
      resource: request.resource,
      description: request.description,
      riskLevel: request.riskLevel,
      estimatedImpact: request.estimatedImpact,
      rollbackCommand: request.rollbackCommand,
    });

    console.log(`\n\x1b[36m📱 Approval request sent to Slack channel ${slackChannel}\x1b[0m`);
    console.log(`\x1b[36m   Message: ${message.ts}\x1b[0m`);
    console.log(`\x1b[33m   Waiting for approval... (timeout: ${timeout / 1000}s)\x1b[0m`);
    console.log(`\x1b[33m   Or press Enter to approve via CLI\x1b[0m\n`);

    // Create a race between Slack approval and CLI input
    const result = await Promise.race([
      waitForSlackApproval(request.id, timeout),
      waitForCLIApproval(request),
    ]);

    await logApproval(request, result.approved, result.approvedBy);
    return result;
  } catch (error) {
    console.log(`\x1b[31mSlack approval failed: ${error instanceof Error ? error.message : error}\x1b[0m`);
    console.log('\x1b[33mFalling back to CLI approval.\x1b[0m');
    return requestApproval(request);
  }
}

/**
 * Wait for Slack approval response
 *
 * In a full implementation, this would listen for webhook events.
 * For now, it checks a response file that could be written by a webhook handler.
 */
async function waitForSlackApproval(
  mutationId: string,
  timeout: number
): Promise<ApprovalResult> {
  const responseFile = join(process.cwd(), '.runbook', 'pending', `${mutationId}.json`);
  const startTime = Date.now();
  const pollInterval = 2000; // Check every 2 seconds

  // Ensure directory exists
  const pendingDir = join(process.cwd(), '.runbook', 'pending');
  if (!existsSync(pendingDir)) {
    mkdirSync(pendingDir, { recursive: true });
  }

  // Write pending request
  const { writeFileSync } = await import('fs');
  writeFileSync(
    responseFile.replace('.json', '_pending.json'),
    JSON.stringify({ mutationId, createdAt: new Date().toISOString() })
  );

  while (Date.now() - startTime < timeout) {
    if (existsSync(responseFile)) {
      try {
        const { readFileSync, unlinkSync } = await import('fs');
        const response = JSON.parse(readFileSync(responseFile, 'utf-8'));
        unlinkSync(responseFile); // Clean up

        return {
          approved: response.approved === true,
          approvedAt: new Date(),
          approvedBy: response.approvedBy || 'slack-user',
          reason: response.reason,
        };
      } catch {
        // Invalid file, continue waiting
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // Timeout - reject
  return {
    approved: false,
    reason: 'Slack approval timed out',
  };
}

/**
 * Wait for CLI approval (as alternative to Slack)
 */
async function waitForCLIApproval(request: MutationRequest): Promise<ApprovalResult> {
  const promptMessage = request.riskLevel === 'critical'
    ? `Type 'yes' to approve: `
    : `Press Enter to approve, or 'n' to reject: `;

  const response = await prompt(promptMessage);
  const normalizedResponse = response.toLowerCase().trim();

  let approved = false;
  if (request.riskLevel === 'critical') {
    approved = normalizedResponse === 'yes';
  } else {
    approved = normalizedResponse !== 'n' && normalizedResponse !== 'no';
  }

  return {
    approved,
    approvedAt: approved ? new Date() : undefined,
    approvedBy: 'cli-user',
    reason: approved ? 'Approved via CLI' : 'Rejected via CLI',
  };
}

/**
 * Log approval to audit file
 */
async function logApproval(
  request: MutationRequest,
  approved: boolean,
  approvedBy?: string
): Promise<void> {
  const auditDir = join(process.cwd(), '.runbook', 'audit');
  const auditFile = join(auditDir, 'approvals.jsonl');

  if (!existsSync(auditDir)) {
    mkdirSync(auditDir, { recursive: true });
  }

  const entry: ApprovalAuditEntry & { approvedBy?: string } = {
    timestamp: new Date().toISOString(),
    mutationId: request.id,
    operation: request.operation,
    resource: request.resource,
    riskLevel: request.riskLevel,
    approved,
    approvedBy,
  };

  appendFileSync(auditFile, JSON.stringify(entry) + '\n');
}

/**
 * Check if Slack approval is available
 */
export function isSlackApprovalAvailable(): boolean {
  return isSlackConfigured() && !!getConfiguredDefaultChannel();
}
