import { describe, expect, it } from 'vitest';
import { JsonLineSplitter, PARSERS, cliArgv, newRunState, type CliEvent } from '../../src/cli/parsers.js';
import type { CliKind } from '@agent/shared';

/** Fixtures follow each vendor's documented headless JSON output format. */
function parseAll(kind: CliKind, lines: unknown[]) {
  const state = newRunState();
  const names = new Map<string, string>();
  const splitter = new JsonLineSplitter();
  const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  const events: CliEvent[] = [];
  // Feed in awkward chunk sizes to exercise line buffering.
  for (let i = 0; i < text.length; i += 17) for (const o of splitter.push(text.slice(i, i + 17))) events.push(...PARSERS[kind](o, state, names));
  for (const o of splitter.end()) events.push(...PARSERS[kind](o, state, names));
  return { state, events };
}

describe('Claude Code stream-json', () => {
  it('extracts session, text, tool calls/results and usage', () => {
    const { state, events } = parseAll('claude_code', [
      { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-x' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Creating file.' }, { type: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: 'a.txt' } }] }, parent_tool_use_id: null },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: 'ok' }] }] }, parent_tool_use_id: null },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] }, parent_tool_use_id: 'sub' },
      { type: 'result', subtype: 'success', is_error: false, session_id: 'sess-1', total_cost_usd: 0.1, usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 20, output_tokens: 7 } },
    ]);
    expect(state).toMatchObject({ sessionId: 'sess-1', model: 'claude-x', errorMessage: null, finished: true });
    expect(state.usage).toEqual({ inputTokens: 15, outputTokens: 7, cachedInputTokens: 20 });
    expect(events).toEqual([
      { type: 'text', text: 'Creating file.' },
      { type: 'tool_call', id: 'tu1', name: 'Write', input: { file_path: 'a.txt' } },
      { type: 'tool_result', id: 'tu1', name: 'Write', content: 'ok', isError: false },
    ]);
  });
  it('reports failures such as missing login', () => {
    const { state } = parseAll('claude_code', [{ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login' }]);
    expect(state.errorMessage).toContain('/login');
  });
});

describe('Codex exec --json', () => {
  it('maps items to events and sums turn usage', () => {
    const { state, events } = parseAll('codex', [
      { type: 'thread.started', thread_id: 'th-1' },
      { type: 'turn.started' },
      { type: 'item.started', item: { id: 'item_0', type: 'command_execution', command: 'bash -lc ls', status: 'in_progress' } },
      { type: 'item.completed', item: { id: 'item_0', type: 'command_execution', command: 'bash -lc ls', aggregated_output: 'a.txt\n', exit_code: 0, status: 'completed' } },
      { type: 'item.completed', item: { id: 'item_1', type: 'reasoning', text: 'thinking' } },
      { type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'Listed files.' } },
      { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 9 } },
    ]);
    expect(state).toMatchObject({ sessionId: 'th-1', finished: true, errorMessage: null });
    expect(state.usage).toEqual({ inputTokens: 100, outputTokens: 9, cachedInputTokens: 80 });
    expect(events).toEqual([
      { type: 'tool_call', id: 'item_0', name: 'shell', input: { command: 'bash -lc ls' } },
      { type: 'tool_result', id: 'item_0', name: 'shell', content: 'a.txt\n[exit code 0]', isError: false },
      { type: 'text', text: 'Listed files.' },
    ]);
  });
  it('reports turn failures', () => {
    const { state } = parseAll('codex', [{ type: 'turn.failed', error: { message: 'unauthorized' } }]);
    expect(state.errorMessage).toBe('unauthorized');
  });
});

describe('Gemini CLI stream-json', () => {
  it('maps messages, tools and stats', () => {
    const { state, events } = parseAll('gemini_cli', [
      { type: 'init', session_id: 'g-1', model: 'gemini-x' },
      { type: 'message', role: 'user', content: 'hi' },
      { type: 'message', role: 'assistant', content: 'Hel', delta: true },
      { type: 'message', role: 'assistant', content: 'lo', delta: true },
      { type: 'tool_use', tool_name: 'run_shell_command', tool_id: 't1', parameters: { command: 'ls' } },
      { type: 'tool_result', tool_id: 't1', status: 'error', error: { message: 'denied' } },
      { type: 'result', status: 'success', stats: { input_tokens: 12, output_tokens: 3, total_tokens: 15 } },
    ]);
    expect(state).toMatchObject({ sessionId: 'g-1', model: 'gemini-x', finished: true });
    expect(state.usage).toMatchObject({ inputTokens: 12, outputTokens: 3 });
    expect(events).toEqual([
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo' },
      { type: 'tool_call', id: 't1', name: 'run_shell_command', input: { command: 'ls' } },
      { type: 'tool_result', id: 't1', name: 'run_shell_command', content: 'denied', isError: true },
    ]);
  });
});

describe('cliArgv', () => {
  it('builds headless invocations without shell interpolation', () => {
    const evil = 'x"; rm -rf / #';
    expect(cliArgv('claude_code', evil, null)).toContain(evil);
    expect(cliArgv('claude_code', 'p', 'sess')).toEqual(expect.arrayContaining(['--resume', 'sess', '--output-format', 'stream-json']));
    expect(cliArgv('codex', 'p', 'th')).toEqual(expect.arrayContaining(['exec', '--json', 'resume', 'th', 'p']));
    expect(cliArgv('gemini_cli', 'p', null)).toEqual(['gemini', '-p', 'p', '--output-format', 'stream-json', '--yolo']);
  });
  it('ignores non-JSON noise lines', () => {
    const s = new JsonLineSplitter();
    expect(s.push('warning: something\n{"type":"x"}\nnot json {\n')).toEqual([{ type: 'x' }]);
  });
});
