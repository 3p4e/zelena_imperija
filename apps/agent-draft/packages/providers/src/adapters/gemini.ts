import type { ProviderKind } from '@agent/shared';
import { BaseProvider, newToolCallId } from '../base.js';
import { HttpClient } from '../http.js';
import { ProviderError } from '../errors.js';
import type { ChatMessage, ChatRequest, FinishReason, ModelInfo, ProviderConfig, StreamEvent, Usage } from '../types.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

interface GeminiPart {
  text?: string;
  thought?: boolean;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { id?: string; name: string; args: unknown };
  functionResponse?: { id?: string; name: string; response: unknown };
}
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}
interface GeminiChunk {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  error?: { message?: string; status?: string };
}
interface GeminiModelsResponse {
  models: {
    name: string;
    displayName?: string;
    inputTokenLimit?: number;
    outputTokenLimit?: number;
    supportedGenerationMethods?: string[];
  }[];
  nextPageToken?: string;
}

export class GeminiProvider extends BaseProvider {
  readonly kind: ProviderKind = 'gemini';
  private readonly http: HttpClient;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ProviderConfig) {
    super();
    this.http = new HttpClient({ fetch: config.fetch, timeoutMs: config.timeoutMs });
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.apiKey = config.apiKey;
  }

  private headers(): Record<string, string> {
    return { 'x-goog-api-key': this.apiKey };
  }

  async listModels(): Promise<ModelInfo[]> {
    const out: ModelInfo[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const url = new URL(`${this.baseUrl}/v1beta/models`);
      url.searchParams.set('pageSize', '200');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const res = await this.http.json<GeminiModelsResponse>(url.toString(), { method: 'GET', headers: this.headers() });
      for (const m of res.models) {
        if (!(m.supportedGenerationMethods ?? []).includes('generateContent')) continue;
        const id = m.name.replace(/^models\//, '');
        if (/embedding|aqa|imagen|veo|tts|audio|image-generation/i.test(id)) continue;
        out.push({
          modelId: id,
          displayName: m.displayName ?? id,
          contextWindow: m.inputTokenLimit ?? null,
          maxOutput: m.outputTokenLimit ?? null,
          inputPricePerMtok: null,
          outputPricePerMtok: null,
          cachedInputPricePerMtok: null,
          supportsVision: true,
          supportsTools: true,
          supportsReasoning: /thinking|gemini-2\.5|gemini-3/i.test(id),
        });
      }
      if (!res.nextPageToken) break;
      pageToken = res.nextPageToken;
    }
    return out;
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamEvent> {
    const url = `${this.baseUrl}/v1beta/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`;
    const sse = this.http.sse(url, {
      method: 'POST',
      headers: this.headers(),
      body: buildGeminiBody(request),
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
    });

    let usage: Usage | null = null;
    let finish: FinishReason = 'stop';
    let sawToolCall = false;

    for await (const msg of sse) {
      const chunk = JSON.parse(msg.data) as GeminiChunk;
      if (chunk.error) throw new ProviderError('unknown', `Gemini stream error: ${chunk.error.message ?? 'unknown'}`);
      for (const cand of chunk.candidates ?? []) {
        for (const part of cand.content?.parts ?? []) {
          if (part.functionCall) {
            sawToolCall = true;
            const id = part.functionCall.id ?? newToolCallId();
            const argsText = JSON.stringify(part.functionCall.args ?? {});
            yield { type: 'tool_call_start', id, name: part.functionCall.name };
            yield { type: 'tool_call_delta', id, argumentsDelta: argsText };
            yield { type: 'tool_call_end', id, name: part.functionCall.name, arguments: part.functionCall.args ?? {} };
          } else if (typeof part.text === 'string' && part.text.length > 0) {
            if (part.thought) yield { type: 'reasoning_delta', text: part.text };
            else yield { type: 'text_delta', text: part.text };
          }
        }
        if (cand.finishReason) finish = mapFinish(cand.finishReason);
      }
      if (chunk.usageMetadata) {
        usage = {
          inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
          outputTokens: (chunk.usageMetadata.candidatesTokenCount ?? 0) + (chunk.usageMetadata.thoughtsTokenCount ?? 0),
          cachedInputTokens: chunk.usageMetadata.cachedContentTokenCount ?? 0,
          reasoningTokens: chunk.usageMetadata.thoughtsTokenCount ?? null,
          costUsd: null,
        };
      }
    }
    if (sawToolCall && finish === 'stop') finish = 'tool_calls';
    yield {
      type: 'usage',
      usage: usage ?? { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: null, costUsd: null },
    };
    yield { type: 'finish', reason: finish };
  }
}

function mapFinish(reason: string): FinishReason {
  switch (reason) {
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
      return 'content_filter';
    case 'MALFORMED_FUNCTION_CALL':
      return 'error';
    default:
      return 'stop';
  }
}

export function buildGeminiBody(request: ChatRequest): Record<string, unknown> {
  const systemText = request.messages
    .filter((m) => m.role === 'system')
    .flatMap((m) => m.content)
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n\n');

  const callNames = new Map<string, string>();
  const contents: GeminiContent[] = [];
  for (const m of request.messages) {
    if (m.role === 'system') continue;
    const c = toGeminiContent(m, callNames);
    if (c.parts.length > 0) contents.push(c);
  }

  const body: Record<string, unknown> = { contents };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };

  const generationConfig: Record<string, unknown> = {};
  if (request.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = request.maxOutputTokens;
  if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
  if (request.structuredOutput) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = stripUnsupportedSchemaKeys(request.structuredOutput.schema);
  }
  if (request.reasoningEffort) {
    const budget = { low: 1024, medium: 8192, high: 24576 }[request.reasoningEffort];
    generationConfig.thinkingConfig = { thinkingBudget: budget, includeThoughts: true };
  }
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

  if (request.tools && request.tools.length > 0 && !request.structuredOutput) {
    body.tools = [
      {
        functionDeclarations: request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: stripUnsupportedSchemaKeys(t.inputSchema),
        })),
      },
    ];
    if (request.toolChoice === 'required') body.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
    else if (request.toolChoice === 'none') body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
  }
  return body;
}

function toGeminiContent(m: ChatMessage, callNames: Map<string, string>): GeminiContent {
  const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user';
  const parts: GeminiPart[] = [];
  for (const p of m.content) {
    switch (p.type) {
      case 'text':
        if (p.text) parts.push({ text: p.text });
        break;
      case 'image':
        parts.push({ inlineData: { mimeType: p.mimeType, data: p.data } });
        break;
      case 'tool_call':
        callNames.set(p.id, p.name);
        parts.push({ functionCall: { id: p.id, name: p.name, args: p.arguments ?? {} } });
        break;
      case 'tool_result': {
        const name = callNames.get(p.toolCallId) ?? 'tool';
        parts.push({
          functionResponse: {
            id: p.toolCallId,
            name,
            response: p.isError ? { error: p.content } : { output: p.content },
          },
        });
        break;
      }
      case 'reasoning':
        break;
    }
  }
  return { role, parts };
}

/** Gemini's schema dialect rejects several JSON Schema keywords; drop them recursively. */
export function stripUnsupportedSchemaKeys(schema: Record<string, unknown>): Record<string, unknown> {
  const banned = new Set(['$schema', 'additionalProperties', 'default', 'examples', '$id', 'const', 'patternProperties']);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (banned.has(k)) continue;
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  };
  return walk(schema) as Record<string, unknown>;
}
