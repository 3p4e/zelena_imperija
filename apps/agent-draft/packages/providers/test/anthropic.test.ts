import { describe, expect, it } from 'vitest';
import { AnthropicProvider, ProviderError, buildAnthropicBody } from '../src/index.js';
import { errorResponse, fetchSequence, jsonResponse, sseResponse } from '../src/testing/index.js';

const KEY = 'sk-ant-test-key-000000000000';

describe('AnthropicProvider', () => {
  it('streams text, tool calls and usage from the Messages API', async () => {
    const { fetch, calls } = fetchSequence([
      sseResponse([
        {
          event: 'message_start',
          data: {
            type: 'message_start',
            message: { usage: { input_tokens: 25, cache_read_input_tokens: 5 } },
          },
        },
        {
          event: 'content_block_start',
          data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        },
        {
          event: 'content_block_delta',
          data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } },
        },
        {
          event: 'content_block_delta',
          data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } },
        },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
        {
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'tool_use', id: 'toolu_1', name: 'fs_write' },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: '{"path":"a.' },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: 'txt"}' },
          },
        },
        { event: 'content_block_stop', data: { type: 'content_block_stop', index: 1 } },
        {
          event: 'message_delta',
          data: { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 12 } },
        },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ]),
    ]);
    const p = new AnthropicProvider({ apiKey: KEY, fetch });
    const res = await p.chat({
      model: 'claude-x',
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'be brief' }] },
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ],
      tools: [{ name: 'fs_write', description: 'write', inputSchema: { type: 'object' } }],
    });
    expect(res.content).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'tool_call', id: 'toolu_1', name: 'fs_write', arguments: { path: 'a.txt' } },
    ]);
    expect(res.usage).toMatchObject({ inputTokens: 25, outputTokens: 12, cachedInputTokens: 5 });
    expect(res.finishReason).toBe('tool_calls');

    const call = calls[0];
    expect(call?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call?.headers['x-api-key']).toBe(KEY);
    expect(call?.headers['anthropic-version']).toBeDefined();
    const body = call?.body as Record<string, unknown>;
    expect(body.system).toBe('be brief');
    expect(body.stream).toBe(true);
    expect((body.tools as unknown[]).length).toBe(1);
  });

  it('maps 401 to an auth ProviderError without leaking the key', async () => {
    const { fetch } = fetchSequence([
      errorResponse(401, { error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } }),
    ]);
    const p = new AnthropicProvider({ apiKey: KEY, fetch });
    const err = await p
      .chat({ model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    const pe = err as ProviderError;
    expect(pe.code).toBe('auth');
    expect(pe.retryable).toBe(false);
    expect(pe.message).not.toContain(KEY);
  });

  it('maps 429 with retry-after to rate_limited', async () => {
    const { fetch } = fetchSequence([
      errorResponse(429, { error: { message: 'slow down' } }, { 'retry-after': '7' }),
    ]);
    const p = new AnthropicProvider({ apiKey: KEY, fetch });
    const err = (await p
      .chat({ model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] })
      .catch((e: unknown) => e)) as ProviderError;
    expect(err.code).toBe('rate_limited');
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(7000);
  });

  it('lists models with pagination', async () => {
    const { fetch, calls } = fetchSequence([
      jsonResponse({ data: [{ id: 'a', display_name: 'A', created_at: '' }], has_more: true, last_id: 'a' }),
      jsonResponse({ data: [{ id: 'b', display_name: 'B', created_at: '' }], has_more: false }),
    ]);
    const p = new AnthropicProvider({ apiKey: KEY, fetch });
    const models = await p.listModels();
    expect(models.map((m) => m.modelId)).toEqual(['a', 'b']);
    expect(calls[1]?.url).toContain('after_id=a');
  });

  it('merges adjacent same-role messages and encodes tool results', () => {
    const body = buildAnthropicBody({
      model: 'm',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'one' }] },
        { role: 'user', content: [{ type: 'text', text: 'two' }] },
        { role: 'assistant', content: [{ type: 'tool_call', id: 't1', name: 'x', arguments: { a: 1 } }] },
        { role: 'tool', content: [{ type: 'tool_result', toolCallId: 't1', content: 'ok', isError: false }] },
      ],
    });
    const messages = body.messages as { role: string; content: unknown[] }[];
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[0]?.content).toHaveLength(2);
    expect(messages[2]?.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
  });

  it('implements structured output through a forced tool and returns JSON text', async () => {
    const { fetch, calls } = fetchSequence([
      sseResponse([
        { data: { type: 'message_start', message: { usage: { input_tokens: 1 } } } },
        {
          data: {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'x', name: '__structured_output' },
          },
        },
        {
          data: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"ok":true}' },
          },
        },
        { data: { type: 'content_block_stop', index: 0 } },
        { data: { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } } },
      ]),
    ]);
    const p = new AnthropicProvider({ apiKey: KEY, fetch });
    const res = await p.chat({
      model: 'm',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      structuredOutput: { name: 'Out', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } },
    });
    expect(res.content).toEqual([{ type: 'text', text: '{"ok":true}' }]);
    expect(res.finishReason).toBe('stop');
    expect((calls[0]?.body as { tool_choice: unknown }).tool_choice).toEqual({
      type: 'tool',
      name: '__structured_output',
    });
  });

  it('honours an abort signal', async () => {
    const controller = new AbortController();
    const fetchStub: typeof fetch = (_u, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const p = new AnthropicProvider({ apiKey: KEY, fetch: fetchStub });
    const promise = p.chat({
      model: 'm',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      signal: controller.signal,
    });
    controller.abort();
    const err = (await promise.catch((e: unknown) => e)) as ProviderError;
    expect(err.code).toBe('aborted');
  });
});
