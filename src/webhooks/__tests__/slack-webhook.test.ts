/**
 * Tests for Slack Webhook Server
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  listPendingApprovals,
  cleanupExpiredApprovals,
  getWebhookConfigFromEnv,
} from '../slack-webhook';

// Test directory for pending files
const TEST_PENDING_DIR = join(process.cwd(), '.runbook-test', 'pending');

describe('SlackWebhook', () => {
  beforeEach(() => {
    // Create test directory
    if (!existsSync(TEST_PENDING_DIR)) {
      mkdirSync(TEST_PENDING_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_PENDING_DIR)) {
      rmSync(TEST_PENDING_DIR, { recursive: true, force: true });
    }
  });

  describe('getWebhookConfigFromEnv', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('should return null if SLACK_SIGNING_SECRET is not set', () => {
      delete process.env.SLACK_SIGNING_SECRET;

      const config = getWebhookConfigFromEnv();

      expect(config).toBeNull();
    });

    it('should return config with defaults when signing secret is set', () => {
      process.env.SLACK_SIGNING_SECRET = 'test-secret';
      delete process.env.SLACK_WEBHOOK_PORT;

      const config = getWebhookConfigFromEnv();

      expect(config).not.toBeNull();
      expect(config?.signingSecret).toBe('test-secret');
      expect(config?.port).toBe(3000);
    });

    it('should use custom port from environment', () => {
      process.env.SLACK_SIGNING_SECRET = 'test-secret';
      process.env.SLACK_WEBHOOK_PORT = '8080';

      const config = getWebhookConfigFromEnv();

      expect(config?.port).toBe(8080);
    });

    it('should use custom pending directory from environment', () => {
      process.env.SLACK_SIGNING_SECRET = 'test-secret';
      process.env.RUNBOOK_PENDING_DIR = '/custom/path';

      const config = getWebhookConfigFromEnv();

      expect(config?.pendingDir).toBe('/custom/path');
    });
  });

  describe('listPendingApprovals', () => {
    it('should return empty array for non-existent directory', () => {
      const nonExistentDir = join(TEST_PENDING_DIR, 'does-not-exist');

      const pending = listPendingApprovals(nonExistentDir);

      expect(pending).toEqual([]);
    });

    it('should return empty array for empty directory', () => {
      const pending = listPendingApprovals(TEST_PENDING_DIR);

      expect(pending).toEqual([]);
    });

    it('should list pending approvals', () => {
      // Create pending files
      writeFileSync(
        join(TEST_PENDING_DIR, 'mut_123_pending.json'),
        JSON.stringify({ mutationId: 'mut_123', createdAt: '2024-01-01T00:00:00Z' })
      );
      writeFileSync(
        join(TEST_PENDING_DIR, 'mut_456_pending.json'),
        JSON.stringify({ mutationId: 'mut_456', createdAt: '2024-01-02T00:00:00Z' })
      );

      const pending = listPendingApprovals(TEST_PENDING_DIR);

      expect(pending).toHaveLength(2);
      expect(pending.map((p) => p.mutationId)).toContain('mut_123');
      expect(pending.map((p) => p.mutationId)).toContain('mut_456');
    });

    it('should ignore response files', () => {
      // Create a pending file and a response file
      writeFileSync(
        join(TEST_PENDING_DIR, 'mut_123_pending.json'),
        JSON.stringify({ mutationId: 'mut_123', createdAt: '2024-01-01T00:00:00Z' })
      );
      writeFileSync(
        join(TEST_PENDING_DIR, 'mut_456.json'),
        JSON.stringify({ approved: true, approvedBy: 'test-user' })
      );

      const pending = listPendingApprovals(TEST_PENDING_DIR);

      expect(pending).toHaveLength(1);
      expect(pending[0].mutationId).toBe('mut_123');
    });

    it('should handle malformed JSON gracefully', () => {
      writeFileSync(
        join(TEST_PENDING_DIR, 'mut_123_pending.json'),
        JSON.stringify({ mutationId: 'mut_123', createdAt: '2024-01-01T00:00:00Z' })
      );
      writeFileSync(join(TEST_PENDING_DIR, 'mut_bad_pending.json'), 'not valid json');

      const pending = listPendingApprovals(TEST_PENDING_DIR);

      expect(pending).toHaveLength(1);
      expect(pending[0].mutationId).toBe('mut_123');
    });
  });

  describe('cleanupExpiredApprovals', () => {
    it('should return 0 for non-existent directory', () => {
      const nonExistentDir = join(TEST_PENDING_DIR, 'does-not-exist');

      const cleaned = cleanupExpiredApprovals(0, nonExistentDir);

      expect(cleaned).toBe(0);
    });

    it('should not remove recent files', () => {
      writeFileSync(
        join(TEST_PENDING_DIR, 'mut_recent_pending.json'),
        JSON.stringify({ mutationId: 'mut_recent', createdAt: new Date().toISOString() })
      );

      // Use a long max age so nothing should be cleaned
      const cleaned = cleanupExpiredApprovals(86400000, TEST_PENDING_DIR);

      expect(cleaned).toBe(0);
      expect(existsSync(join(TEST_PENDING_DIR, 'mut_recent_pending.json'))).toBe(true);
    });

    it('should remove all files when max age is 0', async () => {
      writeFileSync(
        join(TEST_PENDING_DIR, 'mut_123_pending.json'),
        JSON.stringify({ mutationId: 'mut_123' })
      );
      writeFileSync(join(TEST_PENDING_DIR, 'mut_456.json'), JSON.stringify({ approved: true }));

      // Small delay to ensure file mtime is in the past
      await new Promise((resolve) => setTimeout(resolve, 10));

      const cleaned = cleanupExpiredApprovals(0, TEST_PENDING_DIR);

      expect(cleaned).toBe(2);
      expect(existsSync(join(TEST_PENDING_DIR, 'mut_123_pending.json'))).toBe(false);
      expect(existsSync(join(TEST_PENDING_DIR, 'mut_456.json'))).toBe(false);
    });
  });

  describe('Slack signature verification', () => {
    // Helper to generate a valid Slack signature
    function generateSlackSignature(secret: string, timestamp: string, body: string): string {
      const sigBaseString = `v0:${timestamp}:${body}`;
      return 'v0=' + createHmac('sha256', secret).update(sigBaseString).digest('hex');
    }

    it('should generate valid signature format', () => {
      const secret = 'test-signing-secret';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const body = 'test=data';

      const signature = generateSlackSignature(secret, timestamp, body);

      expect(signature).toMatch(/^v0=[a-f0-9]{64}$/);
    });

    it('should produce different signatures for different bodies', () => {
      const secret = 'test-signing-secret';
      const timestamp = Math.floor(Date.now() / 1000).toString();

      const sig1 = generateSlackSignature(secret, timestamp, 'body1');
      const sig2 = generateSlackSignature(secret, timestamp, 'body2');

      expect(sig1).not.toBe(sig2);
    });

    it('should produce different signatures for different secrets', () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const body = 'same-body';

      const sig1 = generateSlackSignature('secret1', timestamp, body);
      const sig2 = generateSlackSignature('secret2', timestamp, body);

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('approval response file format', () => {
    it('should write approval response in correct format', () => {
      const mutationId = 'mut_test_123';
      const response = {
        approved: true,
        approvedBy: 'slack:testuser',
        approvedByName: 'Test User',
        approvedAt: new Date().toISOString(),
        reason: 'Approved via Slack',
      };

      writeFileSync(join(TEST_PENDING_DIR, `${mutationId}.json`), JSON.stringify(response));

      const content = JSON.parse(
        readFileSync(join(TEST_PENDING_DIR, `${mutationId}.json`), 'utf-8')
      );

      expect(content.approved).toBe(true);
      expect(content.approvedBy).toBe('slack:testuser');
      expect(content.approvedByName).toBe('Test User');
      expect(content.reason).toBe('Approved via Slack');
      expect(content.approvedAt).toBeDefined();
    });

    it('should write rejection response in correct format', () => {
      const mutationId = 'mut_test_456';
      const response = {
        approved: false,
        approvedBy: 'slack:testuser',
        approvedByName: 'Test User',
        approvedAt: new Date().toISOString(),
        reason: 'Rejected via Slack',
      };

      writeFileSync(join(TEST_PENDING_DIR, `${mutationId}.json`), JSON.stringify(response));

      const content = JSON.parse(
        readFileSync(join(TEST_PENDING_DIR, `${mutationId}.json`), 'utf-8')
      );

      expect(content.approved).toBe(false);
      expect(content.reason).toBe('Rejected via Slack');
    });
  });

  describe('interaction payload parsing', () => {
    it('should parse approval action_id correctly', () => {
      const actionId = 'approve_mut_123abc';
      const isApprove = actionId.startsWith('approve_');
      const mutationId = actionId.replace('approve_', '');

      expect(isApprove).toBe(true);
      expect(mutationId).toBe('mut_123abc');
    });

    it('should parse rejection action_id correctly', () => {
      const actionId = 'reject_mut_456def';
      const isReject = actionId.startsWith('reject_');
      const mutationId = actionId.replace('reject_', '');

      expect(isReject).toBe(true);
      expect(mutationId).toBe('mut_456def');
    });

    it('should handle block_actions payload structure', () => {
      const payload = {
        type: 'block_actions',
        user: {
          id: 'U123456',
          username: 'testuser',
          name: 'Test User',
        },
        channel: {
          id: 'C123456',
          name: 'general',
        },
        message: {
          ts: '1234567890.123456',
          text: 'Approval request',
        },
        response_url: 'https://hooks.slack.com/actions/...',
        actions: [
          {
            action_id: 'approve_mut_123',
            block_id: 'block_1',
            value: 'mut_123',
            type: 'button' as const,
          },
        ],
        token: 'token',
        trigger_id: 'trigger',
      };

      expect(payload.type).toBe('block_actions');
      expect(payload.actions).toHaveLength(1);
      expect(payload.actions[0].action_id).toBe('approve_mut_123');
      expect(payload.actions[0].value).toBe('mut_123');
    });
  });
});
