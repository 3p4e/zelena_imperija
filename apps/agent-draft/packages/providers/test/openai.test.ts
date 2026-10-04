import { describe, expect, it } from 'vitest';
import {
  OpenAICompatibleProvider,
  OpenAIProvider,
  OpenRouterProvider,
  ProviderError,
  toOAIMessages,
} from '../src/index.js';
import { errorResponse, fetchSequence, jsonResponse, sseResponse } from '../src/testing/index.js';

const KEY = 'sk-test-0000000000000000';

function chunk(
  delta: Record<string, unknown>,
  finish: string | null = null,
  usage?: Record<string, unknown>,
) {
  return {
    data: { id: 'c', choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) },
  };
}

describe('OpenAIProvider (Chat Completions)', () => {
  it('streams text and a tool call assembled from argument deltas', async () => {
    const { fetch, calls } = fetchSequence([
      sseResponse([
        chunk({ role: 'assistant', content: 'Sure' }),
        chunk({ content: ', doing it.' }),
        chunk({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'shell_exec', arguments: '' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"command":' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '"ls"}' } }] }),
        chunk({}, 'tool_calls'),
        {
          data: {
            id: 'c',
            choices: [],
            usage: { prompt_tokens: 40, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 10 } },
          },
        },
        { data: '[DONE]' },
      ]),
    ]);
    const p = new OpenAIProvider({ apiKey: KEY, fetch });
    const res = await p.chat({
      model: 'gpt-x',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'list files' }] }],
      tools: [{ name: 'shell_exec', description: 'run', inputSchema: { type: 'object' } }],
    });
    expect(res.content).toEqual([
      { type: 'text', text: 'Sure, doing it.' },
      { type: 'tool_call', id: 'call_1', name: 'shell_exec', arguments: { command: 'ls' } },
    ]);
    expect(res.usage).toMatchObject({ inputTokens: 40, outputTokens: 9, cachedInputTokens: 10 });
    expect(res.finishReason).toBe('tool_calls');
    const body = calls[0]?.body as Record<string, unknown>;
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect((body.tools as { type: string }[])[0]?.type).toBe('function');
  });

  it('filters non-chat models from the list', async () => {
    const { fetch } = fetchSequence([
      jsonResponse({
        data: [{ id: 'gpt-5' }, { id: 'text-embedding-3-large' }, { id: 'whisper-1' }, { id: 'o3' }],
      }),
    ]);
    const p = new OpenAIProvider({ apiKey: KEY, fetch });
    const models = await p.listModels();
    expect(models.map((m) => m.modelId)).toEqual(['gpt-5', 'o3']);
    expect(models[0]?.supportsReasoning).toBe(true);
  });

  it('maps a 500 to a retryable unavailable error', async () => {
    const { fetch } = fetchSequence([errorResponse(503, 'upstream down')]);
    const p = new OpenAIProvider({ apiKey: KEY, fetch });
    const err = (await p
      .chat({ model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] })
      .catch((e: unknown) => e)) as ProviderError;
    expect(err.code).toBe('unavailable');
    expect(err.retryable).toBe(true);
  });

  it('sends response_format for structured output', async () => {
    const { fetch, calls } = fetchSequence([
      sseResponse([chunk({ content: '{"a":1}' }, 'stop'), { data: '[DONE]' }]),
    ]);
    const p = new OpenAIProvider({ apiKey: KEY, fetch });
    const res = await p.chat({
      model: 'm',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      structuredOutput: { name: 'A', schema: { type: 'object' } },
    });
    expect(res.content).toEqual([{ type: 'text', text: '{"a":1}' }]);
    expect((calls[0]?.body as { response_format: { type: string } }).response_format.type).toBe(
      'json_schema',
    );
  });

  it('converts internal messages to the wire format', () => {
    const out = toOAIMessages({
      role: 'assistant',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'tool_call', id: 'c1', name: 'f', arguments: { x: 1 } },
      ],
    });
    expect(out).toEqual([
      {
        role: 'assistant',
        content: 'hi',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{"x":1}' } }],
      },
    ]);
    const tool = toOAIMessages({
      role: 'tool',
      content: [{ type: 'tool_result', toolCallId: 'c1', content: 'ok', isError: false }],
    });
    expect(tool).toEqual([{ role: 'tool', tool_call_id: 'c1', content: 'ok' }]);
  });
});

describe('OpenAICompatibleProvider (generic)', () => {
  it('requires a base URL', () => {
    expect(() => new OpenAICompatibleProvider({ apiKey: '' })).toThrow(ProviderError);
  });

  it('works without an API key against a local server and reads reasoning_content', async () => {
    const { fetch, calls } = fetchSequence([
      sseResponse([
        chunk({ reasoning_content: 'thinking…' }),
        chunk({ content: 'answer' }, 'stop'),
        { data: '[DONE]' },
      ]),
    ]);
    const p = new OpenAICompatibleProvider({ apiKey: '', baseUrl: 'http://localhost:11434/v1/', fetch });
    const res = await p.chat({
      model: 'llama',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
    });
    expect(calls[0]?.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(calls[0]?.headers.authorization).toBeUndefined();
    expect(res.content).toEqual([
      { type: 'reasoning', text: 'thinking…' },
      { type: 'text', text: 'answer' },
    ]);
  });
});

describe('OpenRouterProvider', () => {
  it('maps pricing per token to per million and reads exact cost from usage', async () => {
    const { fetch, calls } = fetchSequence([
      jsonResponse({
        data: [
          {
            id: 'anthropic/claude',
            name: 'Claude',
            context_length: 200000,
            pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003' },
            architecture: { input_modalities: ['text', 'image'] },
            supported_parameters: ['tools', 'reasoning'],
            top_provider: { max_completion_tokens: 8192 },
          },
        ],
      }),
      sseResponse([
        chunk({ content: 'ok' }, 'stop', { prompt_tokens: 1, completion_tokens: 1, cost: 0.00042 }),
        { data: '[DONE]' },
      ]),
    ]);
    const p = new OpenRouterProvider({ apiKey: KEY, fetch });
    const models = await p.listModels();
    expect(models[0]).toMatchObject({
      modelId: 'anthropic/claude',
      inputPricePerMtok: 3,
      outputPricePerMtok: 15,
      cachedInputPricePerMtok: 0.3,
      supportsVision: true,
      supportsTools: true,
      supportsReasoning: true,
      maxOutput: 8192,
    });
    const res = await p.chat({
      model: 'anthropic/claude',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
    });
    expect(res.usage.costUsd).toBeCloseTo(0.00042);
    expect((calls[1]?.body as { usage: unknown }).usage).toEqual({ include: true });
  });
});
