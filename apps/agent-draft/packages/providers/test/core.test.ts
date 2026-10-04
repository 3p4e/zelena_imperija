import { describe, expect, it } from 'vitest';
import { collectStream, createProvider, parseSse, sanitize, type StreamEvent } from '../src/index.js';
import { MockProvider } from '../src/testing/index.js';

async function* gen(events: StreamEvent[]): AsyncIterable<StreamEvent> {
  await Promise.resolve();
  for (const e of events) yield e;
}

describe('collectStream', () => {
  it('assembles text, reasoning and tool calls in order', async () => {
    const res = await collectStream(
      gen([
        { type: 'reasoning_delta', text: 'r1' },
        { type: 'text_delta', text: 'a' },
        { type: 'text_delta', text: 'b' },
        { type: 'tool_call_start', id: '1', name: 't' },
        { type: 'tool_call_delta', id: '1', argumentsDelta: '{"x":1}' },
        { type: 'tool_call_end', id: '1', name: 't', arguments: { x: 1 } },
        { type: 'text_delta', text: 'c' },
        { type: 'usage', usage: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0, reasoningTokens: null, costUsd: null } },
        { type: 'finish', reason: 'tool_calls' },
      ]),
    );
    expect(res.content).toEqual([
      { type: 'reasoning', text: 'r1' },
      { type: 'text', text: 'ab' },
      { type: 'tool_call', id: '1', name: 't', arguments: { x: 1 } },
      { type: 'text', text: 'c' },
    ]);
    expect(res.finishReason).toBe('tool_calls');
  });
});

describe('parseSse', () => {
  it('handles multi-line data and chunk boundaries', async () => {
    const text = 'event: a\ndata: {"x":\ndata: 1}\n\n: comment\ndata: second\n\n';
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < text.length; i += 5) c.enqueue(enc.encode(text.slice(i, i + 5)));
        c.close();
      },
    });
    const out = [];
    for await (const m of parseSse(body)) out.push(m);
    expect(out).toEqual([
      { event: 'a', data: '{"x":\n1}' },
      { event: null, data: 'second' },
    ]);
  });
});

describe('sanitize', () => {
  it('redacts key-like strings', () => {
    expect(sanitize('bad key sk-abcdefghijklmnop and AIzaSyABCDEFGHIJKLMNOPQRSTUV')).toBe('bad key [redacted] and [redacted]');
  });
});

describe('createProvider', () => {
  it('creates every supported kind', () => {
    expect(createProvider('anthropic', { apiKey: 'k' }).kind).toBe('anthropic');
    expect(createProvider('openai', { apiKey: 'k' }).kind).toBe('openai');
    expect(createProvider('gemini', { apiKey: 'k' }).kind).toBe('gemini');
    expect(createProvider('openrouter', { apiKey: 'k' }).kind).toBe('openrouter');
    expect(createProvider('openai_compatible', { apiKey: '', baseUrl: 'http://x/v1' }).kind).toBe('openai_compatible');
  });
});

describe('MockProvider', () => {
  it('follows its script and records requests', async () => {
    const p = new MockProvider({
      turns: [
        { kind: 'tool_call', name: 'fs_write', arguments: { path: 'a' }, text: 'Writing' },
        { kind: 'text', text: 'Done' },
      ],
    });
    const r1 = await p.chat({ model: 'mock-1', messages: [] });
    expect(r1.content[1]).toMatchObject({ type: 'tool_call', name: 'fs_write' });
    const r2 = await p.chat({ model: 'mock-1', messages: [] });
    expect(r2.content).toEqual([{ type: 'text', text: 'Done' }]);
    const r3 = await p.chat({ model: 'mock-1', messages: [] });
    expect(r3.content).toEqual([{ type: 'text', text: 'Done' }]);
    expect(p.requests).toHaveLength(3);
  });
});
