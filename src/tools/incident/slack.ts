/**
 * Slack Integration
 *
 * Post investigation updates, summaries, and alerts to Slack channels.
 */

const SLACK_API_BASE = 'https://slack.com/api';

interface SlackConfig {
  botToken: string;
  defaultChannel?: string;
}

let config: SlackConfig | null = null;

export function configure(botToken: string, defaultChannel?: string): void {
  config = { botToken, defaultChannel };
}

function getBotToken(): string {
  if (config?.botToken) return config.botToken;
  if (process.env.SLACK_BOT_TOKEN) return process.env.SLACK_BOT_TOKEN;
  throw new Error('Slack bot token not configured. Set SLACK_BOT_TOKEN environment variable.');
}

function getDefaultChannel(): string | undefined {
  return config?.defaultChannel || process.env.SLACK_DEFAULT_CHANNEL;
}

async function slackFetch<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = getBotToken();

  const response = await fetch(`${SLACK_API_BASE}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as { ok: boolean; error?: string } & T;

  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }

  return data;
}

export interface SlackMessage {
  ts: string;
  channel: string;
}

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
}

/**
 * Check if Slack is configured
 */
export function isSlackConfigured(): boolean {
  return !!(config?.botToken || process.env.SLACK_BOT_TOKEN);
}

/**
 * Post a message to a Slack channel
 */
export async function postMessage(
  channel: string,
  text: string,
  options: {
    threadTs?: string;
    blocks?: SlackBlock[];
    attachments?: SlackAttachment[];
    unfurlLinks?: boolean;
  } = {}
): Promise<SlackMessage> {
  const response = await slackFetch<{ ts: string; channel: string }>('chat.postMessage', {
    channel,
    text,
    thread_ts: options.threadTs,
    blocks: options.blocks,
    attachments: options.attachments,
    unfurl_links: options.unfurlLinks ?? false,
  });

  return {
    ts: response.ts,
    channel: response.channel,
  };
}

/**
 * Update an existing message
 */
export async function updateMessage(
  channel: string,
  ts: string,
  text: string,
  options: {
    blocks?: SlackBlock[];
    attachments?: SlackAttachment[];
  } = {}
): Promise<SlackMessage> {
  const response = await slackFetch<{ ts: string; channel: string }>('chat.update', {
    channel,
    ts,
    text,
    blocks: options.blocks,
    attachments: options.attachments,
  });

  return {
    ts: response.ts,
    channel: response.channel,
  };
}

/**
 * Post an investigation update to a channel
 */
export async function postInvestigationUpdate(
  channel: string,
  update: {
    incidentId: string;
    title: string;
    status: 'investigating' | 'identified' | 'monitoring' | 'resolved';
    summary: string;
    hypotheses?: Array<{ statement: string; status: 'active' | 'confirmed' | 'pruned' }>;
    findings?: string[];
    nextSteps?: string[];
    severity?: 'low' | 'medium' | 'high' | 'critical';
  },
  threadTs?: string
): Promise<SlackMessage> {
  const statusEmoji: Record<string, string> = {
    investigating: ':mag:',
    identified: ':dart:',
    monitoring: ':eyes:',
    resolved: ':white_check_mark:',
  };

  const severityColor: Record<string, string> = {
    low: '#36a64f',
    medium: '#f2c744',
    high: '#ff9800',
    critical: '#e53935',
  };

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${statusEmoji[update.status] || ':information_source:'} Investigation Update: ${update.title}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Incident:*\n${update.incidentId}`,
        },
        {
          type: 'mrkdwn',
          text: `*Status:*\n${update.status.charAt(0).toUpperCase() + update.status.slice(1)}`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Summary:*\n${update.summary}`,
      },
    },
  ];

  // Add hypotheses if present
  if (update.hypotheses && update.hypotheses.length > 0) {
    const hypothesisList = update.hypotheses
      .map((h) => {
        const icon =
          h.status === 'confirmed'
            ? ':white_check_mark:'
            : h.status === 'pruned'
              ? ':x:'
              : ':thinking_face:';
        return `${icon} ${h.statement}`;
      })
      .join('\n');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Hypotheses:*\n${hypothesisList}`,
      },
    });
  }

  // Add findings if present
  if (update.findings && update.findings.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Key Findings:*\n${update.findings.map((f) => `• ${f}`).join('\n')}`,
      },
    });
  }

  // Add next steps if present
  if (update.nextSteps && update.nextSteps.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Next Steps:*\n${update.nextSteps.map((s) => `• ${s}`).join('\n')}`,
      },
    });
  }

  // Add timestamp
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `:robot_face: Posted by Runbook AI at ${new Date().toISOString()}`,
      },
    ],
  });

  const attachments: SlackAttachment[] = update.severity
    ? [
        {
          color: severityColor[update.severity] || '#808080',
          fallback: update.summary,
        },
      ]
    : [];

  return postMessage(channel, update.summary, {
    threadTs,
    blocks,
    attachments,
  });
}

/**
 * Post a root cause identified message
 */
export async function postRootCauseIdentified(
  channel: string,
  details: {
    incidentId: string;
    rootCause: string;
    confidence: 'low' | 'medium' | 'high';
    evidence: string[];
    suggestedRemediation?: string;
  },
  threadTs?: string
): Promise<SlackMessage> {
  const confidenceEmoji: Record<string, string> = {
    low: ':thinking_face:',
    medium: ':grey_question:',
    high: ':white_check_mark:',
  };

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: ':dart: Root Cause Identified',
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${details.rootCause}*\n\nConfidence: ${confidenceEmoji[details.confidence]} ${details.confidence.toUpperCase()}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Supporting Evidence:*\n${details.evidence.map((e) => `• ${e}`).join('\n')}`,
      },
    },
  ];

  if (details.suggestedRemediation) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Suggested Remediation:*\n${details.suggestedRemediation}`,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `:robot_face: Analysis by Runbook AI | Incident: ${details.incidentId}`,
      },
    ],
  });

  return postMessage(channel, `Root cause identified: ${details.rootCause}`, {
    threadTs,
    blocks,
  });
}

/**
 * Request approval via Slack (for mutations)
 */
export async function requestSlackApproval(
  channel: string,
  request: {
    id: string;
    operation: string;
    resource: string;
    description: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    estimatedImpact?: string;
    rollbackCommand?: string;
  }
): Promise<SlackMessage> {
  const riskColor: Record<string, string> = {
    low: '#36a64f',
    medium: '#f2c744',
    high: '#ff9800',
    critical: '#e53935',
  };

  const riskEmoji: Record<string, string> = {
    low: ':large_green_circle:',
    medium: ':large_yellow_circle:',
    high: ':large_orange_circle:',
    critical: ':red_circle:',
  };

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: ':warning: Mutation Approval Required',
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Operation:*\n\`${request.operation}\``,
        },
        {
          type: 'mrkdwn',
          text: `*Resource:*\n${request.resource}`,
        },
        {
          type: 'mrkdwn',
          text: `*Risk Level:*\n${riskEmoji[request.riskLevel]} ${request.riskLevel.toUpperCase()}`,
        },
        {
          type: 'mrkdwn',
          text: `*Request ID:*\n${request.id}`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Description:*\n${request.description}`,
      },
    },
  ];

  if (request.estimatedImpact) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Estimated Impact:*\n${request.estimatedImpact}`,
      },
    });
  }

  if (request.rollbackCommand) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Rollback Command:*\n\`\`\`${request.rollbackCommand}\`\`\``,
      },
    });
  }

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Approve',
          emoji: true,
        },
        style: 'primary',
        action_id: `approve_${request.id}`,
        value: request.id,
      },
      {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Reject',
          emoji: true,
        },
        style: 'danger',
        action_id: `reject_${request.id}`,
        value: request.id,
      },
    ],
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: ':robot_face: Requested by Runbook AI',
      },
    ],
  });

  return postMessage(
    channel,
    `Approval requested for ${request.operation} on ${request.resource}`,
    {
      blocks,
      attachments: [{ color: riskColor[request.riskLevel], fallback: request.description }],
    }
  );
}

/**
 * Get messages from a channel (for reading incident context)
 */
export async function getChannelMessages(
  channel: string,
  options: {
    threadTs?: string;
    limit?: number;
    oldest?: string;
    latest?: string;
  } = {}
): Promise<Array<{ ts: string; user: string; text: string; threadTs?: string }>> {
  const method = options.threadTs ? 'conversations.replies' : 'conversations.history';

  const response = await slackFetch<{
    messages: Array<{
      ts: string;
      user: string;
      text: string;
      thread_ts?: string;
    }>;
  }>(method, {
    channel,
    thread_ts: options.threadTs,
    limit: options.limit || 100,
    oldest: options.oldest,
    latest: options.latest,
  });

  return response.messages.map((m) => ({
    ts: m.ts,
    user: m.user,
    text: m.text,
    threadTs: m.thread_ts,
  }));
}

/**
 * Find channel by name
 */
export async function findChannel(name: string): Promise<SlackChannel | null> {
  try {
    const response = await slackFetch<{
      channels: Array<{
        id: string;
        name: string;
        is_private: boolean;
      }>;
    }>('conversations.list', {
      types: 'public_channel,private_channel',
      limit: 200,
    });

    const channel = response.channels.find((c) => c.name === name.replace(/^#/, ''));

    if (channel) {
      return {
        id: channel.id,
        name: channel.name,
        isPrivate: channel.is_private,
      };
    }

    return null;
  } catch {
    return null;
  }
}

// Slack Block Kit types
interface SlackBlock {
  type: 'header' | 'section' | 'context' | 'actions' | 'divider';
  text?: {
    type: 'plain_text' | 'mrkdwn';
    text: string;
    emoji?: boolean;
  };
  fields?: Array<{
    type: 'plain_text' | 'mrkdwn';
    text: string;
  }>;
  elements?: Array<SlackBlockElement>;
}

interface SlackBlockElement {
  type: 'button' | 'mrkdwn' | 'plain_text';
  text?: string | { type: 'plain_text' | 'mrkdwn'; text: string; emoji?: boolean };
  style?: 'primary' | 'danger';
  action_id?: string;
  value?: string;
}

interface SlackAttachment {
  color?: string;
  fallback?: string;
  title?: string;
  text?: string;
  fields?: Array<{ title: string; value: string; short?: boolean }>;
}

/**
 * Get the default channel from config
 */
export function getConfiguredDefaultChannel(): string | undefined {
  return getDefaultChannel();
}
