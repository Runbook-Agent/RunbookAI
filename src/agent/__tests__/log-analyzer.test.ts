/**
 * Tests for Log Analyzer
 */

import { describe, it, expect } from 'vitest';
import {
  parseLogLine,
  analyzePatterns,
  extractServiceMentions,
  getTimeRange,
  countByLevel,
  generateHypothesesFromPatterns,
  generateSummary,
  analyzeLogs,
  formatLogsForLLM,
  createLogAnalysisPrompt,
  filterLogsByTime,
  filterLogsByLevel,
  searchLogs,
  ERROR_PATTERNS,
} from '../log-analyzer';

describe('parseLogLine', () => {
  it('should parse ISO timestamp', () => {
    const line = '2024-01-15T10:30:45.123Z ERROR Something went wrong';
    const result = parseLogLine(line);

    expect(result.timestamp).toBeInstanceOf(Date);
    expect(result.timestamp?.toISOString()).toBe('2024-01-15T10:30:45.123Z');
    expect(result.level).toBe('ERROR');
  });

  it('should parse syslog format timestamp', () => {
    const line = 'Jan 15 10:30:45 ERROR Something went wrong';
    const result = parseLogLine(line);

    expect(result.timestamp).toBeInstanceOf(Date);
    expect(result.level).toBe('ERROR');
  });

  it('should parse unix timestamp in milliseconds', () => {
    const line = '1705318245123 ERROR Something went wrong';
    const result = parseLogLine(line);

    expect(result.timestamp).toBeInstanceOf(Date);
    expect(result.level).toBe('ERROR');
  });

  it('should parse unix timestamp in seconds', () => {
    const line = '1705318245 ERROR Something went wrong';
    const result = parseLogLine(line);

    expect(result.timestamp).toBeInstanceOf(Date);
    expect(result.level).toBe('ERROR');
  });

  it('should extract log level', () => {
    expect(parseLogLine('DEBUG test').level).toBe('DEBUG');
    expect(parseLogLine('INFO test').level).toBe('INFO');
    expect(parseLogLine('WARN test').level).toBe('WARN');
    expect(parseLogLine('[WARNING] test').level).toBe('WARNING');
    expect(parseLogLine('ERROR test').level).toBe('ERROR');
    expect(parseLogLine('CRITICAL test').level).toBe('CRITICAL');
    expect(parseLogLine('FATAL test').level).toBe('FATAL');
  });

  it('should extract source from brackets', () => {
    const line = '[api-gateway] ERROR Something went wrong';
    const result = parseLogLine(line);

    expect(result.source).toBe('api-gateway');
  });

  it('should extract source from angle brackets', () => {
    const line = '<user-service> INFO Request received';
    const result = parseLogLine(line);

    expect(result.source).toBe('user-service');
  });

  it('should handle logs without timestamp or level', () => {
    const line = 'Just some random log message';
    const result = parseLogLine(line);

    expect(result.timestamp).toBeUndefined();
    expect(result.level).toBeUndefined();
    expect(result.message).toBe(line);
    expect(result.raw).toBe(line);
  });
});

describe('analyzePatterns', () => {
  it('should detect connection timeout patterns', () => {
    const logs = [
      '2024-01-15T10:00:00Z ERROR connection timeout after 30s',
      '2024-01-15T10:01:00Z ERROR connect ETIMEDOUT to database',
      '2024-01-15T10:02:00Z INFO Normal operation',
    ];

    const result = analyzePatterns(logs);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].patternName).toBe('connectionTimeout');
    expect(result[0].matchCount).toBe(2);
    expect(result[0].category).toBe('connectivity');
  });

  it('should detect out of memory patterns', () => {
    const logs = [
      '2024-01-15T10:00:00Z CRITICAL JavaScript heap out of memory',
      '2024-01-15T10:01:00Z ERROR OutOfMemoryError: Java heap space',
    ];

    const result = analyzePatterns(logs);

    expect(result.length).toBeGreaterThan(0);
    const oomPattern = result.find((p) => p.patternName === 'outOfMemory');
    expect(oomPattern).toBeDefined();
    expect(oomPattern?.severity).toBe('critical');
    expect(oomPattern?.matchCount).toBe(2);
  });

  it('should detect database errors', () => {
    const logs = [
      'ERROR: deadlock detected while waiting for lock',
      'WARN: connection pool exhausted, waiting for connection',
      'ERROR: query timeout after 60s',
    ];

    const result = analyzePatterns(logs);
    const dbPattern = result.find((p) => p.patternName === 'databaseError');

    expect(dbPattern).toBeDefined();
    expect(dbPattern?.matchCount).toBe(3);
  });

  it('should detect rate limiting', () => {
    const logs = [
      'WARN: rate limit exceeded for API',
      'ERROR: 429 Too Many Requests',
      'INFO: Request throttled, retrying',
    ];

    const result = analyzePatterns(logs);
    const rlPattern = result.find((p) => p.patternName === 'rateLimiting');

    expect(rlPattern).toBeDefined();
    expect(rlPattern?.matchCount).toBe(3);
  });

  it('should detect kubernetes issues', () => {
    const logs = [
      'pod user-service-abc123 evicted due to memory pressure',
      'liveness probe failed for container app',
      'CrashLoopBackOff for pod api-gateway-xyz',
    ];

    const result = analyzePatterns(logs);
    const k8sPattern = result.find((p) => p.patternName === 'kubernetes');

    expect(k8sPattern).toBeDefined();
    // "evicted" and "CrashLoopBackOff" match; "liveness probe failed" matches too
    expect(k8sPattern?.matchCount).toBeGreaterThanOrEqual(2);
  });

  it('should track first and last seen timestamps', () => {
    const logs = [
      '2024-01-15T10:00:00Z ERROR connection timeout',
      '2024-01-15T10:30:00Z ERROR connection timeout',
      '2024-01-15T11:00:00Z ERROR connection timeout',
    ];

    const result = analyzePatterns(logs);
    const pattern = result.find((p) => p.patternName === 'connectionTimeout');

    expect(pattern?.firstSeen).toBe('2024-01-15T10:00:00.000Z');
    expect(pattern?.lastSeen).toBe('2024-01-15T11:00:00.000Z');
  });

  it('should limit examples to 3', () => {
    const logs = [
      'ERROR 1 connection timeout',
      'ERROR 2 connection timeout',
      'ERROR 3 connection timeout',
      'ERROR 4 connection timeout',
      'ERROR 5 connection timeout',
    ];

    const result = analyzePatterns(logs);
    const pattern = result.find((p) => p.patternName === 'connectionTimeout');

    expect(pattern?.examples.length).toBe(3);
  });

  it('should sort by severity then count', () => {
    const logs = [
      'CRITICAL out of memory',
      'ERROR connection timeout',
      'ERROR connection timeout',
      'ERROR connection timeout',
    ];

    const result = analyzePatterns(logs);

    // Critical should come first despite lower count
    expect(result[0].severity).toBe('critical');
    expect(result[1].severity).toBe('error');
  });
});

describe('extractServiceMentions', () => {
  it('should extract from known services list', () => {
    const logs = [
      'api-gateway returned 500',
      'user-service connection failed',
      'api-gateway timeout',
    ];

    const result = extractServiceMentions(logs, ['api-gateway', 'user-service']);

    expect(result.get('api-gateway')).toBe(2);
    expect(result.get('user-service')).toBe(1);
  });

  it('should extract from service= pattern', () => {
    const logs = ['service=api-gateway status=error', 'service="user-service" latency=500'];

    const result = extractServiceMentions(logs);

    expect(result.get('api-gateway')).toBe(1);
    expect(result.get('user-service')).toBe(1);
  });

  it('should extract from log source', () => {
    const logs = [
      '[api-gateway] ERROR something',
      '[user-service] INFO request',
      '[api-gateway] WARN slow',
    ];

    const result = extractServiceMentions(logs);

    expect(result.get('api-gateway')).toBe(2);
    expect(result.get('user-service')).toBe(1);
  });
});

describe('getTimeRange', () => {
  it('should extract time range from logs', () => {
    const logs = [
      '2024-01-15T10:00:00Z INFO start',
      '2024-01-15T10:30:00Z INFO middle',
      '2024-01-15T11:00:00Z INFO end',
    ];

    const result = getTimeRange(logs);

    expect(result?.start.toISOString()).toBe('2024-01-15T10:00:00.000Z');
    expect(result?.end.toISOString()).toBe('2024-01-15T11:00:00.000Z');
  });

  it('should return undefined if no timestamps', () => {
    const logs = ['no timestamp here', 'or here'];

    const result = getTimeRange(logs);

    expect(result).toBeUndefined();
  });
});

describe('countByLevel', () => {
  it('should count errors and warnings', () => {
    const logs = [
      '2024-01-15T10:00:00Z ERROR error 1',
      '2024-01-15T10:00:01Z ERROR error 2',
      '2024-01-15T10:00:02Z WARN warning 1',
      '2024-01-15T10:00:03Z CRITICAL critical 1',
      '2024-01-15T10:00:04Z INFO info',
    ];

    const result = countByLevel(logs);

    expect(result.errors).toBe(3); // ERROR, ERROR, CRITICAL
    expect(result.warnings).toBe(1);
  });
});

describe('generateHypothesesFromPatterns', () => {
  it('should generate unique hypotheses from matches', () => {
    const matches = [
      {
        patternName: 'connectionTimeout',
        hypothesis: 'Network issue',
        matchCount: 5,
        category: 'connectivity',
        severity: 'error' as const,
        examples: [],
      },
      {
        patternName: 'databaseError',
        hypothesis: 'Database issue',
        matchCount: 3,
        category: 'database',
        severity: 'error' as const,
        examples: [],
      },
      {
        patternName: 'connectionRefused',
        hypothesis: 'Network issue',
        matchCount: 2,
        category: 'connectivity',
        severity: 'error' as const,
        examples: [],
      },
    ];

    const result = generateHypothesesFromPatterns(matches);

    expect(result).toHaveLength(2); // Deduped
    expect(result).toContain('Network issue');
    expect(result).toContain('Database issue');
  });
});

describe('generateSummary', () => {
  it('should generate comprehensive summary', () => {
    const result = generateSummary({
      totalLines: 1000,
      errorCount: 50,
      warningCount: 100,
      patternMatches: [
        {
          patternName: 'outOfMemory',
          category: 'resources',
          severity: 'critical',
          hypothesis: 'Memory',
          matchCount: 10,
          examples: [],
        },
        {
          patternName: 'connectionTimeout',
          category: 'connectivity',
          severity: 'error',
          hypothesis: 'Network',
          matchCount: 20,
          examples: [],
        },
      ],
      suggestedHypotheses: [],
      timeRange: {
        start: new Date('2024-01-15T10:00:00Z'),
        end: new Date('2024-01-15T11:00:00Z'),
      },
      serviceMentions: new Map([
        ['api-gateway', 50],
        ['user-service', 30],
      ]),
    });

    expect(result).toContain('1000 log lines');
    expect(result).toContain('50 errors');
    expect(result).toContain('100 warnings');
    expect(result).toContain('outOfMemory');
    expect(result).toContain('connectionTimeout');
    expect(result).toContain('api-gateway');
  });
});

describe('analyzeLogs', () => {
  it('should perform full analysis', () => {
    const logs = [
      '2024-01-15T10:00:00Z ERROR [api-gateway] connection timeout',
      '2024-01-15T10:01:00Z ERROR [user-service] database connection failed',
      '2024-01-15T10:02:00Z WARN [api-gateway] high latency detected',
      '2024-01-15T10:03:00Z INFO [api-gateway] request completed',
    ];

    const result = analyzeLogs(logs, ['api-gateway', 'user-service']);

    expect(result.totalLines).toBe(4);
    expect(result.errorCount).toBe(2);
    expect(result.warningCount).toBe(1);
    expect(result.patternMatches.length).toBeGreaterThan(0);
    expect(result.suggestedHypotheses.length).toBeGreaterThan(0);
    expect(result.serviceMentions.get('api-gateway')).toBeGreaterThan(0);
    expect(result.summary).toBeDefined();
  });
});

describe('formatLogsForLLM', () => {
  it('should return all logs if under limit', () => {
    const logs = ['log 1', 'log 2', 'log 3'];
    const result = formatLogsForLLM(logs, 10);

    expect(result).toBe('log 1\nlog 2\nlog 3');
  });

  it('should sample logs if over limit', () => {
    const logs = Array.from({ length: 300 }, (_, i) => `log ${i}`);
    const result = formatLogsForLLM(logs, 100);

    expect(result).toContain('log 0'); // First logs
    expect(result).toContain('lines omitted'); // Omission message
    expect(result).toContain('log 299'); // Last logs
  });
});

describe('createLogAnalysisPrompt', () => {
  it('should create prompt with logs and time range', () => {
    const logs = ['ERROR connection timeout', 'WARN high latency'];
    const result = createLogAnalysisPrompt(logs, '2024-01-15T10:00:00Z', '2024-01-15T11:00:00Z');

    expect(result).toContain('connection timeout');
    expect(result).toContain('2024-01-15T10:00:00Z');
    expect(result).toContain('2024-01-15T11:00:00Z');
  });
});

describe('filterLogsByTime', () => {
  it('should filter logs by time window', () => {
    const logs = [
      '2024-01-15T09:00:00Z INFO before window',
      '2024-01-15T10:30:00Z ERROR in window',
      '2024-01-15T12:00:00Z INFO after window',
      'no timestamp log',
    ];

    const result = filterLogsByTime(
      logs,
      new Date('2024-01-15T10:00:00Z'),
      new Date('2024-01-15T11:00:00Z')
    );

    expect(result).toHaveLength(2); // In window + no timestamp
    expect(result).toContain('2024-01-15T10:30:00Z ERROR in window');
    expect(result).toContain('no timestamp log');
  });
});

describe('filterLogsByLevel', () => {
  it('should filter logs by minimum level', () => {
    const logs = [
      '2024-01-15T10:00:00Z DEBUG debug message',
      '2024-01-15T10:00:01Z INFO info message',
      '2024-01-15T10:00:02Z WARN warning message',
      '2024-01-15T10:00:03Z ERROR error message',
      'no level message',
    ];

    const result = filterLogsByLevel(logs, 'WARN');

    expect(result).toHaveLength(3); // WARN, ERROR, no level
    expect(result).not.toContain('2024-01-15T10:00:00Z DEBUG debug message');
    expect(result).not.toContain('2024-01-15T10:00:01Z INFO info message');
  });
});

describe('searchLogs', () => {
  it('should search with string query', () => {
    const logs = ['ERROR connection timeout', 'INFO request completed', 'ERROR connection refused'];

    const result = searchLogs(logs, 'connection');

    expect(result).toHaveLength(2);
  });

  it('should search with regex', () => {
    const logs = [
      'ERROR connection timeout after 30s',
      'ERROR connection timeout after 60s',
      'INFO normal operation',
    ];

    const result = searchLogs(logs, /timeout after \d+s/);

    expect(result).toHaveLength(2);
  });
});

describe('ERROR_PATTERNS', () => {
  it('should have all expected pattern categories', () => {
    expect(ERROR_PATTERNS.connectionTimeout).toBeDefined();
    expect(ERROR_PATTERNS.outOfMemory).toBeDefined();
    expect(ERROR_PATTERNS.databaseError).toBeDefined();
    expect(ERROR_PATTERNS.rateLimiting).toBeDefined();
    expect(ERROR_PATTERNS.authError).toBeDefined();
    expect(ERROR_PATTERNS.serviceError).toBeDefined();
    expect(ERROR_PATTERNS.diskError).toBeDefined();
    expect(ERROR_PATTERNS.dnsError).toBeDefined();
    expect(ERROR_PATTERNS.sslError).toBeDefined();
    expect(ERROR_PATTERNS.processCrash).toBeDefined();
    expect(ERROR_PATTERNS.kubernetes).toBeDefined();
  });

  it('should have hypothesis for each pattern', () => {
    for (const [name, pattern] of Object.entries(ERROR_PATTERNS)) {
      expect(pattern.hypothesis, `${name} should have hypothesis`).toBeDefined();
      expect(pattern.hypothesis.length, `${name} hypothesis should not be empty`).toBeGreaterThan(
        0
      );
    }
  });
});
