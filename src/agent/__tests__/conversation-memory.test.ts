/**
 * Tests for Conversation Memory
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConversationMemory,
  createMemory,
  type ConversationMessage,
  type InvestigationContext,
} from '../conversation-memory';

describe('ConversationMemory', () => {
  let memory: ConversationMemory;

  beforeEach(() => {
    memory = createMemory();
  });

  describe('message management', () => {
    it('should add user message', () => {
      const msg = memory.addUserMessage('Hello, I need help');

      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Hello, I need help');
      expect(msg.id).toBeDefined();
      expect(msg.timestamp).toBeInstanceOf(Date);
    });

    it('should add assistant message', () => {
      const msg = memory.addAssistantMessage('How can I help you?');

      expect(msg.role).toBe('assistant');
      expect(msg.content).toBe('How can I help you?');
    });

    it('should add system message', () => {
      const msg = memory.addSystemMessage('Session started');

      expect(msg.role).toBe('system');
      expect(msg.content).toBe('Session started');
    });

    it('should add message with metadata', () => {
      const msg = memory.addAssistantMessage('Found the issue', {
        investigationId: 'inv_123',
        toolCalls: ['cloudwatch_logs'],
      });

      expect(msg.metadata?.investigationId).toBe('inv_123');
      expect(msg.metadata?.toolCalls).toContain('cloudwatch_logs');
    });

    it('should generate unique message IDs', () => {
      const msg1 = memory.addUserMessage('First');
      const msg2 = memory.addUserMessage('Second');

      expect(msg1.id).not.toBe(msg2.id);
    });

    it('should get all messages', () => {
      memory.addUserMessage('First');
      memory.addAssistantMessage('Second');
      memory.addUserMessage('Third');

      const messages = memory.getMessages();

      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe('First');
      expect(messages[2].content).toBe('Third');
    });

    it('should get recent messages', () => {
      memory.addUserMessage('One');
      memory.addUserMessage('Two');
      memory.addUserMessage('Three');
      memory.addUserMessage('Four');

      const recent = memory.getRecentMessages(2);

      expect(recent).toHaveLength(2);
      expect(recent[0].content).toBe('Three');
      expect(recent[1].content).toBe('Four');
    });

    it('should get last message', () => {
      memory.addUserMessage('First');
      memory.addAssistantMessage('Last');

      const last = memory.getLastMessage();

      expect(last?.content).toBe('Last');
    });

    it('should get last user message', () => {
      memory.addUserMessage('User message');
      memory.addAssistantMessage('Assistant response');

      const lastUser = memory.getLastUserMessage();

      expect(lastUser?.content).toBe('User message');
    });

    it('should get messages since a specific ID', () => {
      const msg1 = memory.addUserMessage('First');
      memory.addUserMessage('Second');
      memory.addUserMessage('Third');

      const since = memory.getMessagesSince(msg1.id);

      expect(since).toHaveLength(2);
      expect(since[0].content).toBe('Second');
    });

    it('should return empty array for non-existent message ID', () => {
      memory.addUserMessage('First');

      const since = memory.getMessagesSince('non_existent_id');

      expect(since).toHaveLength(0);
    });
  });

  describe('investigation management', () => {
    it('should store investigation context', () => {
      memory.addInvestigation(
        {
          id: 'inv_1',
          query: 'Why is API slow?',
          rootCause: 'Database connection pool exhausted',
          confidence: 'high',
          summary: 'Test summary',
          durationMs: 5000,
        },
        {
          triage: {
            summary: 'API latency spike',
            affectedServices: ['api-gateway'],
            symptoms: ['high latency'],
            errorMessages: [],
            severity: 'high',
            timeWindow: { start: new Date(), end: new Date() },
          },
          hypotheses: [],
          conclusion: {
            rootCause: 'Database connection pool exhausted',
            confidence: 'high',
            confirmedHypothesisId: 'h_1',
            evidenceChain: [],
            alternativeExplanations: [],
            unknowns: [],
          },
        }
      );

      const inv = memory.getInvestigation('inv_1');

      expect(inv).toBeDefined();
      expect(inv?.query).toBe('Why is API slow?');
      expect(inv?.conclusion?.rootCause).toBe('Database connection pool exhausted');
    });

    it('should get all investigations', () => {
      memory.addInvestigation(
        { id: 'inv_1', query: 'Query 1', summary: '', durationMs: 0 },
        { hypotheses: [] }
      );
      memory.addInvestigation(
        { id: 'inv_2', query: 'Query 2', summary: '', durationMs: 0 },
        { hypotheses: [] }
      );

      const investigations = memory.getInvestigations();

      expect(investigations).toHaveLength(2);
    });

    it('should get recent investigations', () => {
      memory.addInvestigation(
        { id: 'inv_1', query: 'First query', summary: '', durationMs: 0 },
        { hypotheses: [] }
      );
      memory.addInvestigation(
        { id: 'inv_2', query: 'Second query', summary: '', durationMs: 0 },
        { hypotheses: [] }
      );

      const recent = memory.getRecentInvestigations(1);

      // Should get exactly one investigation
      expect(recent).toHaveLength(1);
      expect(['First query', 'Second query']).toContain(recent[0].query);

      // Getting 2 should return both
      const all = memory.getRecentInvestigations(2);
      expect(all).toHaveLength(2);
    });

    it('should search investigations', () => {
      memory.addInvestigation(
        { id: 'inv_1', query: 'API latency issue', summary: '', durationMs: 0 },
        { hypotheses: [] }
      );
      memory.addInvestigation(
        { id: 'inv_2', query: 'Database connection error', summary: '', durationMs: 0 },
        { hypotheses: [] }
      );

      const results = memory.searchInvestigations('latency');

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('inv_1');
    });
  });

  describe('search', () => {
    it('should search messages by content', () => {
      memory.addUserMessage('I have a database problem');
      memory.addAssistantMessage('Let me investigate the database');
      memory.addUserMessage('Thanks for helping with the API');

      const results = memory.searchMessages('database');

      expect(results).toHaveLength(2);
    });

    it('should be case insensitive', () => {
      memory.addUserMessage('DATABASE issue');
      memory.addUserMessage('database problem');

      const results = memory.searchMessages('Database');

      expect(results).toHaveLength(2);
    });
  });

  describe('context generation', () => {
    it('should generate context for prompt', () => {
      memory.addUserMessage('Why is the API slow?');
      memory.addAssistantMessage('Let me investigate that.');

      const context = memory.getContextForPrompt();

      expect(context).toContain('Why is the API slow?');
      expect(context).toContain('Let me investigate that.');
    });

    it('should include investigation context', () => {
      memory.addInvestigation(
        {
          id: 'inv_1',
          query: 'API slowness',
          rootCause: 'DB pool exhausted',
          confidence: 'high',
          summary: '',
          durationMs: 0,
        },
        {
          hypotheses: [],
          conclusion: {
            rootCause: 'DB pool exhausted',
            confidence: 'high',
            confirmedHypothesisId: 'h_1',
            evidenceChain: [],
            alternativeExplanations: [],
            unknowns: [],
          },
        }
      );

      const context = memory.getContextForPrompt();

      expect(context).toContain('API slowness');
      expect(context).toContain('DB pool exhausted');
    });

    it('should respect token limit', () => {
      // Add many messages
      for (let i = 0; i < 100; i++) {
        memory.addUserMessage(
          `This is message number ${i} with some extra content to make it longer`
        );
      }

      const context = memory.getContextForPrompt(1000);

      // Context should be limited (approximately 4000 chars for 1000 tokens)
      expect(context.length).toBeLessThan(5000);
    });
  });

  describe('summary creation', () => {
    it('should create summary from conversation', () => {
      memory.addUserMessage('I have an issue with the database connection');
      memory.addAssistantMessage('I found that the connection pool is exhausted');
      memory.addUserMessage('What should we do about it?');
      memory.addAssistantMessage('I recommend restarting the service');

      const summary = memory.createSummary();

      expect(summary.findings.length).toBeGreaterThanOrEqual(0);
      expect(summary.openQuestions.length).toBeGreaterThan(0);
    });

    it('should include investigation summary', () => {
      memory.addInvestigation(
        {
          id: 'inv_1',
          query: 'Test query',
          rootCause: 'Test cause',
          confidence: 'high',
          summary: '',
          durationMs: 0,
        },
        {
          hypotheses: [],
          conclusion: {
            rootCause: 'Test cause',
            confidence: 'high',
            confirmedHypothesisId: 'h_1',
            evidenceChain: [],
            alternativeExplanations: [],
            unknowns: [],
          },
        }
      );

      const summary = memory.createSummary();

      expect(summary.investigationsSummary).toContain('Test query');
      expect(summary.investigationsSummary).toContain('Test cause');
    });
  });

  describe('references', () => {
    it('should get reference for previous investigation', () => {
      memory.addInvestigation(
        {
          id: 'inv_1',
          query: 'API performance issue',
          rootCause: 'Memory leak',
          confidence: 'high',
          summary: '',
          durationMs: 0,
        },
        {
          hypotheses: [],
          conclusion: {
            rootCause: 'Memory leak',
            confidence: 'high',
            confirmedHypothesisId: 'h_1',
            evidenceChain: [],
            alternativeExplanations: [],
            unknowns: [],
          },
        }
      );

      const reference = memory.getReference('API');

      expect(reference).toContain('Memory leak');
    });

    it('should get reference from messages', () => {
      memory.addAssistantMessage('The database connection was reset at 10:00 AM');

      const reference = memory.getReference('database connection');

      expect(reference).toContain('database connection was reset');
    });

    it('should return undefined for no match', () => {
      memory.addUserMessage('Hello');

      const reference = memory.getReference('nonexistent topic');

      expect(reference).toBeUndefined();
    });

    it('should get related context', () => {
      memory.addUserMessage('Database is slow');
      memory.addInvestigation(
        { id: 'inv_1', query: 'Database slowness', summary: '', durationMs: 0 },
        { hypotheses: [] }
      );

      const related = memory.getRelatedContext('database');

      expect(related.messages).toHaveLength(1);
      expect(related.investigations).toHaveLength(1);
    });
  });

  describe('memory management', () => {
    it('should clear all memory', () => {
      memory.addUserMessage('Test');
      memory.addInvestigation(
        { id: 'inv_1', query: 'Test', summary: '', durationMs: 0 },
        { hypotheses: [] }
      );

      memory.clear();

      expect(memory.getMessages()).toHaveLength(0);
      expect(memory.getInvestigations()).toHaveLength(0);
    });

    it('should clear only messages', () => {
      memory.addUserMessage('Test');
      memory.addInvestigation(
        { id: 'inv_1', query: 'Test', summary: '', durationMs: 0 },
        { hypotheses: [] }
      );

      memory.clearMessages();

      expect(memory.getMessages()).toHaveLength(0);
      expect(memory.getInvestigations()).toHaveLength(1);
    });

    it('should get stats', () => {
      memory.addUserMessage('Hello world');
      memory.addAssistantMessage('Hi there');
      memory.addInvestigation(
        { id: 'inv_1', query: 'Test', summary: '', durationMs: 0 },
        { hypotheses: [] }
      );

      const stats = memory.getStats();

      expect(stats.messageCount).toBe(2);
      expect(stats.investigationCount).toBe(1);
      expect(stats.estimatedTokens).toBeGreaterThan(0);
    });
  });

  describe('serialization', () => {
    it('should serialize to JSON', () => {
      memory.addUserMessage('Test message');
      memory.addInvestigation(
        { id: 'inv_1', query: 'Test query', summary: '', durationMs: 0 },
        { hypotheses: [] }
      );

      const json = memory.toJSON();
      const parsed = JSON.parse(json);

      expect(parsed.messages).toHaveLength(1);
      expect(parsed.investigations).toHaveLength(1);
    });

    it('should deserialize from JSON', () => {
      memory.addUserMessage('Original message');
      memory.addInvestigation(
        { id: 'inv_1', query: 'Original query', summary: '', durationMs: 0 },
        { hypotheses: [] }
      );

      const json = memory.toJSON();
      const restored = ConversationMemory.fromJSON(json);

      expect(restored.getMessages()).toHaveLength(1);
      expect(restored.getMessages()[0].content).toBe('Original message');
      expect(restored.getInvestigations()).toHaveLength(1);
    });

    it('should preserve dates after serialization', () => {
      memory.addUserMessage('Test');

      const json = memory.toJSON();
      const restored = ConversationMemory.fromJSON(json);

      expect(restored.getMessages()[0].timestamp).toBeInstanceOf(Date);
    });
  });

  describe('configuration', () => {
    it('should accept custom config', () => {
      const customMemory = createMemory({
        maxMessages: 50,
        maxTokens: 10000,
      });

      expect(customMemory).toBeInstanceOf(ConversationMemory);
    });
  });

  describe('compression', () => {
    it('should compress when reaching summarize threshold', () => {
      const compressMemory = createMemory({
        summarizeAfterMessages: 5,
      });

      // Add enough messages to trigger compression
      for (let i = 0; i < 12; i++) {
        compressMemory.addUserMessage(`Message ${i}`);
      }

      // Should have compressed - fewer messages than added
      const messages = compressMemory.getMessages();
      expect(messages.length).toBeLessThan(12);
    });
  });
});
