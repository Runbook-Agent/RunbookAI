/**
 * Slack Webhook Server
 *
 * Handles interactive message payloads from Slack (button clicks for approvals).
 * Runs as a standalone server or can be integrated into existing HTTP servers.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { createHmac, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { updateMessage } from '../tools/incident/slack';

/**
 * Slack interaction payload types
 */
interface SlackInteractionPayload {
  type: 'block_actions' | 'message_action' | 'shortcut';
  user: {
    id: string;
    username: string;
    name: string;
  };
  channel?: {
    id: string;
    name: string;
  };
  message?: {
    ts: string;
    text: string;
  };
  response_url: string;
  actions: Array<{
    action_id: string;
    block_id: string;
    value: string;
    type: 'button';
  }>;
  token: string;
  trigger_id: string;
}

/**
 * Webhook server configuration
 */
export interface WebhookServerConfig {
  port: number;
  signingSecret: string;
  pendingDir?: string;
}

/**
 * Parse URL-encoded form data
 */
function parseFormData(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    result[key] = value;
  }
  return result;
}

/**
 * Verify Slack request signature
 */
function verifySlackSignature(
  signingSecret: string,
  signature: string | undefined,
  timestamp: string | undefined,
  body: string
): boolean {
  if (!signature || !timestamp) {
    return false;
  }

  // Check timestamp is within 5 minutes
  const requestTimestamp = parseInt(timestamp, 10);
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - requestTimestamp) > 300) {
    console.error('Slack request timestamp too old');
    return false;
  }

  // Compute signature
  const sigBaseString = `v0:${timestamp}:${body}`;
  const mySignature = 'v0=' + createHmac('sha256', signingSecret)
    .update(sigBaseString)
    .digest('hex');

  // Timing-safe comparison
  try {
    return timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Handle approval button click
 */
async function handleApprovalAction(
  payload: SlackInteractionPayload,
  action: SlackInteractionPayload['actions'][0],
  pendingDir: string
): Promise<{ ok: boolean; message: string }> {
  const actionId = action.action_id;
  const mutationId = action.value;

  const isApprove = actionId.startsWith('approve_');
  const isReject = actionId.startsWith('reject_');

  if (!isApprove && !isReject) {
    return { ok: false, message: 'Unknown action' };
  }

  // Write response file for the polling approval flow
  const responseFile = join(pendingDir, `${mutationId}.json`);
  const pendingFile = join(pendingDir, `${mutationId}_pending.json`);

  // Check if this mutation is still pending
  if (!existsSync(pendingFile)) {
    return { ok: false, message: 'This approval request has expired or was already handled' };
  }

  const response = {
    approved: isApprove,
    approvedBy: `slack:${payload.user.username}`,
    approvedByName: payload.user.name,
    approvedAt: new Date().toISOString(),
    reason: isApprove ? 'Approved via Slack' : 'Rejected via Slack',
  };

  writeFileSync(responseFile, JSON.stringify(response));

  // Clean up pending file
  try {
    unlinkSync(pendingFile);
  } catch {
    // Ignore cleanup errors
  }

  // Update the Slack message to show the result
  if (payload.channel && payload.message) {
    try {
      const statusEmoji = isApprove ? ':white_check_mark:' : ':x:';
      const statusText = isApprove ? 'APPROVED' : 'REJECTED';
      const statusColor = isApprove ? '#36a64f' : '#e53935';

      await updateMessage(
        payload.channel.id,
        payload.message.ts,
        `Mutation ${statusText} by ${payload.user.name}`,
        {
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: `${statusEmoji} Mutation ${statusText}`,
                emoji: true,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*${isApprove ? 'Approved' : 'Rejected'} by:* ${payload.user.name}\n*Time:* ${new Date().toISOString()}`,
              },
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `:robot_face: Handled by Runbook AI | Mutation ID: ${mutationId}`,
                },
              ],
            },
          ],
          attachments: [{ color: statusColor, fallback: `Mutation ${statusText}` }],
        }
      );
    } catch (error) {
      console.error('Failed to update Slack message:', error);
    }
  }

  return {
    ok: true,
    message: isApprove ? 'Mutation approved' : 'Mutation rejected',
  };
}

/**
 * Create the webhook request handler
 */
function createRequestHandler(config: WebhookServerConfig) {
  const pendingDir = config.pendingDir || join(process.cwd(), '.runbook', 'pending');

  return async (req: IncomingMessage, res: ServerResponse) => {
    // Health check endpoint
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
      return;
    }

    // Only handle POST to /slack/interactions
    if (req.url !== '/slack/interactions' || req.method !== 'POST') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    // Read body
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    // Verify Slack signature
    const signature = req.headers['x-slack-signature'] as string | undefined;
    const timestamp = req.headers['x-slack-request-timestamp'] as string | undefined;

    if (!verifySlackSignature(config.signingSecret, signature, timestamp, body)) {
      console.error('Invalid Slack signature');
      res.writeHead(401);
      res.end('Invalid signature');
      return;
    }

    try {
      // Parse the form-encoded payload
      const formData = parseFormData(body);
      const payload: SlackInteractionPayload = JSON.parse(formData.payload || '{}');

      // Handle block_actions (button clicks)
      if (payload.type === 'block_actions' && payload.actions?.length > 0) {
        const action = payload.actions[0];

        // Handle approval buttons
        if (action.action_id.startsWith('approve_') || action.action_id.startsWith('reject_')) {
          const result = await handleApprovalAction(payload, action, pendingDir);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            response_action: 'clear',
            text: result.message,
          }));
          return;
        }
      }

      // Acknowledge other interactions
      res.writeHead(200);
      res.end();
    } catch (error) {
      console.error('Error handling Slack interaction:', error);
      res.writeHead(500);
      res.end('Internal error');
    }
  };
}

/**
 * Start the Slack webhook server
 */
export function startWebhookServer(config: WebhookServerConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = createRequestHandler(config);
    const server = createServer(handler);

    // Ensure pending directory exists
    const pendingDir = config.pendingDir || join(process.cwd(), '.runbook', 'pending');
    if (!existsSync(pendingDir)) {
      mkdirSync(pendingDir, { recursive: true });
    }

    server.on('error', (error) => {
      console.error('Webhook server error:', error);
      reject(error);
    });

    server.listen(config.port, () => {
      console.log(`Slack webhook server listening on port ${config.port}`);
      console.log(`Endpoint: http://localhost:${config.port}/slack/interactions`);
      console.log(`Health check: http://localhost:${config.port}/health`);
      resolve();
    });
  });
}

/**
 * Get configuration from environment
 */
export function getWebhookConfigFromEnv(): WebhookServerConfig | null {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    return null;
  }

  return {
    port: parseInt(process.env.SLACK_WEBHOOK_PORT || '3000', 10),
    signingSecret,
    pendingDir: process.env.RUNBOOK_PENDING_DIR,
  };
}

/**
 * List pending approval requests
 */
export function listPendingApprovals(pendingDir?: string): Array<{ mutationId: string; createdAt: string }> {
  const dir = pendingDir || join(process.cwd(), '.runbook', 'pending');

  if (!existsSync(dir)) {
    return [];
  }

  const { readdirSync } = require('fs');
  const files = readdirSync(dir) as string[];

  return files
    .filter((f: string) => f.endsWith('_pending.json'))
    .map((f: string) => {
      try {
        const content = readFileSync(join(dir, f), 'utf-8');
        return JSON.parse(content);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Clean up expired pending approvals
 */
export function cleanupExpiredApprovals(maxAgeMs: number = 3600000, pendingDir?: string): number {
  const dir = pendingDir || join(process.cwd(), '.runbook', 'pending');

  if (!existsSync(dir)) {
    return 0;
  }

  const { readdirSync, statSync } = require('fs');
  const files = readdirSync(dir) as string[];
  const now = Date.now();
  let cleaned = 0;

  for (const file of files) {
    try {
      const filePath = join(dir, file);
      const stat = statSync(filePath);
      if (now - stat.mtimeMs >= maxAgeMs) {
        unlinkSync(filePath);
        cleaned++;
      }
    } catch {
      // Ignore errors
    }
  }

  return cleaned;
}
