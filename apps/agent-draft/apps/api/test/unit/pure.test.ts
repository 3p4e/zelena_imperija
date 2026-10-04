import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@agent/providers';
import { estimateCostUsd } from '../../src/metering/cost.js';
import { parseTestSummary } from '../../src/tools/builtin/test-parse.js';
import { workspacePath } from '../../src/sandbox/paths.js';
import { fitToContext, repairToolPairs } from '../../src/agent/history.js';
import { AppError } from '../../src/lib/errors.js';

const usage = (i: number, o: number, cached = 0, costUsd: number | null = null) => ({
  inputTokens: i,
  outputTokens: o,
  cachedInputTokens: cached,
  reasoningTokens: null,
  costUsd,
});

describe('estimateCostUsd', () => {
  const pricing = { inputPricePerMtok: '3', outputPricePerMtok: '15', cachedInputPricePerMtok: '0.3' };
  it('prices input, cached input and output separately', () => {
    expect(estimateCostUsd(usage(1_000_000, 100_000), pricing)).toBeCloseTo(3 + 1.5);
    expect(estimateCostUsd(usage(1_000_000, 0, 500_000), pricing)).toBeCloseTo(1.5 + 0.15);
  });
  it('prefers provider-reported exact cost', () => {
    expect(estimateCostUsd(usage(1_000_000, 0, 0, 0.42), pricing)).toBe(0.42);
  });
  it('returns null (unknown) when the registry has no price', () => {
    expect(
      estimateCostUsd(usage(10, 10), {
        inputPricePerMtok: null,
        outputPricePerMtok: '1',
        cachedInputPricePerMtok: null,
      }),
    ).toBeNull();
    expect(estimateCostUsd(usage(10, 10), null)).toBeNull();
  });
});

describe('parseTestSummary', () => {
  it.each([
    ['vitest', ' Tests  3 passed | 1 failed (4)', 1, { framework: 'vitest', passed: 3, failed: 1, total: 4 }],
    ['vitest-all-pass', ' Tests  4 passed (4)', 0, { framework: 'vitest', passed: 4, failed: 0, total: 4 }],
    [
      'jest',
      'Tests:       1 failed, 3 passed, 4 total',
      1,
      { framework: 'jest', passed: 3, failed: 1, total: 4 },
    ],
    [
      'pytest',
      '===== 5 passed, 2 failed in 0.31s =====',
      1,
      { framework: 'pytest', passed: 5, failed: 2, total: 7 },
    ],
    ['node:test', '# pass 2\n# fail 0', 0, { framework: 'node:test', passed: 2, failed: 0, total: 2 }],
    ['mocha', '  6 passing (12ms)\n  1 failing', 1, { framework: 'mocha', passed: 6, failed: 1, total: 7 }],
  ])('%s', (_name, out, code, expected) => {
    expect(parseTestSummary(out, code)).toMatchObject(expected);
  });
  it('strips ANSI colours', () => {
    expect(parseTestSummary('\u001b[32m Tests  2 passed (2)\u001b[0m', 0)).toMatchObject({ passed: 2 });
  });
  it('falls back to the exit code', () => {
    expect(parseTestSummary('ok', 0)).toMatchObject({ framework: 'unknown', total: null });
    expect(parseTestSummary('boom', 2).text).toContain('exit code 2');
  });
});

describe('workspacePath', () => {
  it('normalises relative and absolute workspace paths', () => {
    expect(workspacePath('src/a.ts')).toBe('/workspace/src/a.ts');
    expect(workspacePath('/workspace/src/../b.ts')).toBe('/workspace/b.ts');
    expect(workspacePath('./x')).toBe('/workspace/x');
  });
  it.each(['../etc/passwd', '/etc/passwd/../../..', 'a/../../b', '', 'a\0b'])('rejects %j', (p) => {
    if (p === '/etc/passwd/../../..') {
      // Absolute paths are interpreted relative to the workspace root, never the host root.
      expect(() => workspacePath(p)).toThrow(AppError);
      return;
    }
    expect(() => workspacePath(p)).toThrow(AppError);
  });
  it('maps absolute non-workspace paths under the workspace', () => {
    expect(workspacePath('/etc/passwd')).toBe('/workspace/etc/passwd');
  });
});

describe('history repair', () => {
  it('answers dangling tool calls so providers accept the transcript', () => {
    const h: ChatMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
      { role: 'assistant', content: [{ type: 'tool_call', id: 'a', name: 't', arguments: {} }] },
      { role: 'user', content: [{ type: 'text', text: 'next' }] },
    ];
    const fixed = repairToolPairs(h);
    expect(fixed.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user']);
    expect(fixed[2]?.content[0]).toMatchObject({ type: 'tool_result', toolCallId: 'a', isError: true });
  });
  it('drops orphan tool results', () => {
    const fixed = repairToolPairs([
      { role: 'user', content: [{ type: 'text', text: 'x' }] },
      { role: 'tool', content: [{ type: 'tool_result', toolCallId: 'zzz', content: 'r', isError: false }] },
    ]);
    expect(fixed.map((m) => m.role)).toEqual(['user']);
  });
  it('trims the oldest turns to fit the context window and starts on a user message', () => {
    const big = 'x'.repeat(40_000);
    const h: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) {
      h.push({ role: 'user', content: [{ type: 'text', text: `${i} ${big}` }] });
      h.push({ role: 'assistant', content: [{ type: 'text', text: big }] });
    }
    const out = fitToContext(h, 64_000);
    expect(out.length).toBeLessThan(h.length);
    expect(out[0]?.role).toBe('user');
    expect(out.at(-1)).toBe(h.at(-1));
  });
});
