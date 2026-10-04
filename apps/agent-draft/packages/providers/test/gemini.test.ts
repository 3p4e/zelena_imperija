import { describe, expect, it } from 'vitest';
import { GeminiProvider, buildGeminiBody, stripUnsupportedSchemaKeys, type ProviderError } from '../src/index.js';
import { errorResponse, fetchSequence, jsonResponse, sseResponse } from '../src/testing/index.js';

const KEY = 'AIzaSyTESTKEY0000000000000000000000000';

describe('GeminiProvider', () => {
  it('streams text, thoughts and function calls', async () => {
    const { fetch, calls } = fetchSequence([
      sseResponse([
        { data: { candidates: [{ content: { parts: [{ text: 'plan', thought: true }] } }] } },
        { data: { candidates: [{ content: { parts: [{ text: 'Hello ' }] } }] } },
        {
          data: {
            candidates: [{ content: { parts: [{ functionCall: { name: 'fs_read', args: { path: 'x' } } }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 2, cachedContentTokenCount: 3 },
          },
        },
      ]),
    ]);
    const p = new GeminiProvider({ apiKey: KEY, fetch });
    const res = await p.chat({
      model: 'gemini-x',
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'sys' }] },
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ],
      tools: [{ name: 'fs_read', description: 'r', inputSchema: { type: 'object', additionalProperties: false } }],
    });
    expect(res.content.slice(0, 2)).toEqual([
      { type: 'reasoning', text: 'plan' },
      { type: 'text', text: 'Hello ' },
    ]);
    expect(res.content[2]).toMatchObject({ type: 'tool_call', name: 'fs_read', arguments: { path: 'x' } });
    // Gemini omits call ids; generated ids must be unique so results pair with the right call across turns.
    const id = (res.content[2] as { id: string }).id;
    expect(id).toMatch(/^call_[0-9a-f]{20}$/);
    const again = await new GeminiProvider({ apiKey: KEY, fetch: fetchSequence([sseResponse([{ data: { candidates: [{ content: { parts: [{ functionCall: { name: 'x', args: {} } }] } }] } }])]).fetch }).chat({ model: 'm', messages: [] });
    expect((again.content[0] as { id: string }).id).not.toBe(id);
    expect(res.usage).toMatchObject({ inputTokens: 10, outputTokens: 6, cachedInputTokens: 3, reasoningTokens: 2 });
    expect(res.finishReason).toBe('tool_calls');
    expect(calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x:streamGenerateContent?alt=sse');
    expect(calls[0]?.headers['x-goog-api-key']).toBe(KEY);
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'sys' }] });
    const decl = (body.tools as { functionDeclarations: { parameters: Record<string, unknown> }[] }[])[0]?.functionDeclarations[0];
    expect(decl?.parameters.additionalProperties).toBeUndefined();
  });

  it('encodes tool results as functionResponse with the original name', () => {
    const body = buildGeminiBody({
      model: 'm',
      messages: [
        { role: 'assistant', content: [{ type: 'tool_call', id: 'c1', name: 'shell_exec', arguments: { command: 'ls' } }] },
        { role: 'tool', content: [{ type: 'tool_result', toolCallId: 'c1', content: 'a b', isError: false }] },
      ],
    });
    const contents = body.contents as { role: string; parts: Record<string, unknown>[] }[];
    expect(contents[0]?.role).toBe('model');
    expect(contents[1]?.parts[0]).toEqual({ functionResponse: { id: 'c1', name: 'shell_exec', response: { output: 'a b' } } });
  });

  it('lists only generateContent models and skips embeddings', async () => {
    const { fetch } = fetchSequence([
      jsonResponse({
        models: [
          { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        ],
      }),
    ]);
    const p = new GeminiProvider({ apiKey: KEY, fetch });
    const models = await p.listModels();
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ modelId: 'gemini-2.5-pro', contextWindow: 1048576, supportsReasoning: true });
  });

  it('maps 400 API_KEY_INVALID to a non-retryable error and hides the key', async () => {
    const { fetch } = fetchSequence([errorResponse(400, { error: { message: `API key not valid: ${KEY}`, status: 'INVALID_ARGUMENT' } })]);
    const p = new GeminiProvider({ apiKey: KEY, fetch });
    const err = (await p
      .chat({ model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] })
      .catch((e: unknown) => e)) as ProviderError;
    expect(err.code).toBe('bad_request');
    expect(err.retryable).toBe(false);
    expect(err.message).not.toContain(KEY);
  });

  it('strips unsupported schema keys recursively', () => {
    const out = stripUnsupportedSchemaKeys({
      type: 'object',
      additionalProperties: false,
      properties: { a: { type: 'string', default: 'x' }, b: { type: 'array', items: { type: 'object', additionalProperties: true } } },
    });
    expect(out).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'array', items: { type: 'object' } } },
    });
  });
});
