import type { ProviderKind } from '@agent/shared';
import { BaseProvider, newToolCallId, safeJson } from '../base.js';
import { HttpClient } from '../http.js';
import { ProviderError } from '../errors.js';
import type {
  ChatMessage,
  ChatRequest,
  FinishReason,
  ModelInfo,
  ProviderConfig,
  StreamEvent,
  ToolDefinition,
  Usage,
} from '../types.js';

interface OAITextContent {
  type: 'text';
  text: string;
}
interface OAIImageContent {
  type: 'image_url';
  image_url: { url: string };
}
interface OAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
type OAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | (OAITextContent | OAIImageContent)[] }
  | { role: 'assistant'; content: string | null; tool_calls?: OAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface OAIModelsResponse {
  data: {
    id: string;
    owned_by?: string;
    context_length?: number;
    pricing?: { prompt?: string; completion?: string };
  }[];
}

interface OAIChunk {
  id?: string;
  choices?: {
    index: number;
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
    cost?: number;
  } | null;
  error?: { message?: string; code?: string | number };
}

export interface OpenAICompatibleOptions extends ProviderConfig {
  kind?: ProviderKind;
  /** Whether to send `stream_options: {include_usage:true}` (OpenAI, OpenRouter, most clones). */
  includeUsageOption?: boolean;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
}

/**
 * Chat Completions protocol. Covers OpenAI, OpenRouter, DeepSeek, Mistral, xAI,
 * Ollama, LM Studio and anything else that speaks `/v1/chat/completions`.
 */
export class OpenAICompatibleProvider extends BaseProvider {
  readonly kind: ProviderKind;
  protected readonly http: HttpClient;
  protected readonly baseUrl: string;
  protected readonly apiKey: string;
  protected readonly includeUsageOption: boolean;
  protected readonly extraHeaders: Record<string, string>;
  protected readonly extraBody: Record<string, unknown>;

  constructor(options: OpenAICompatibleOptions) {
    super();
    if (!options.baseUrl)
      throw new ProviderError('bad_request', 'An OpenAI-compatible provider needs a base URL.', {
        retryable: false,
      });
    this.kind = options.kind ?? 'openai_compatible';
    this.http = new HttpClient({ fetch: options.fetch, timeoutMs: options.timeoutMs });
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.includeUsageOption = options.includeUsageOption ?? true;
    this.extraHeaders = options.extraHeaders ?? {};
    this.extraBody = options.extraBody ?? {};
  }

  protected headers(): Record<string, string> {
    const h: Record<string, string> = { ...this.extraHeaders };
    if (this.apiKey) h.authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await this.http.json<OAIModelsResponse>(`${this.baseUrl}/models`, {
      method: 'GET',
      headers: this.headers(),
    });
    return res.data.map((m) => this.mapModel(m));
  }

  protected mapModel(m: OAIModelsResponse['data'][number]): ModelInfo {
    return {
      modelId: m.id,
      displayName: m.id,
      contextWindow: m.context_length ?? null,
      maxOutput: null,
      inputPricePerMtok: null,
      outputPricePerMtok: null,
      cachedInputPricePerMtok: null,
      supportsVision: null,
      supportsTools: null,
      supportsReasoning: null,
    };
  }

  protected buildBody(request: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.flatMap(toOAIMessages),
      stream: true,
      ...this.extraBody,
    };
    if (this.includeUsageOption) body.stream_options = { include_usage: true };
    if (request.maxOutputTokens !== undefined) body.max_tokens = request.maxOutputTokens;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(toOAITool);
      if (request.toolChoice === 'required') body.tool_choice = 'required';
      else if (request.toolChoice === 'none') body.tool_choice = 'none';
    }
    if (request.structuredOutput) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: request.structuredOutput.name,
          schema: request.structuredOutput.schema,
          strict: false,
        },
      };
    }
    if (request.reasoningEffort) body.reasoning_effort = request.reasoningEffort;
    return body;
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamEvent> {
    const sse = this.http.sse(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: this.buildBody(request),
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
    });

    const calls = new Map<number, { id: string; name: string; args: string; started: boolean }>();
    let usage: Usage | null = null;
    let finish: FinishReason = 'stop';

    for await (const msg of sse) {
      if (msg.data.trim() === '[DONE]') break;
      let chunk: OAIChunk;
      try {
        chunk = JSON.parse(msg.data) as OAIChunk;
      } catch {
        continue;
      }
      if (chunk.error) {
        throw new ProviderError('unknown', `Provider stream error: ${chunk.error.message ?? 'unknown'}`);
      }
      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta;
        if (delta?.content) yield { type: 'text_delta', text: delta.content };
        const reasoning = delta?.reasoning_content ?? delta?.reasoning;
        if (reasoning) yield { type: 'reasoning_delta', text: reasoning };
        for (const tc of delta?.tool_calls ?? []) {
          let entry = calls.get(tc.index);
          if (!entry) {
            entry = { id: tc.id ?? newToolCallId(), name: tc.function?.name ?? '', args: '', started: false };
            calls.set(tc.index, entry);
          }
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name = entry.name ? entry.name : tc.function.name;
          if (!entry.started && entry.name) {
            entry.started = true;
            yield { type: 'tool_call_start', id: entry.id, name: entry.name };
          }
          if (tc.function?.arguments) {
            entry.args += tc.function.arguments;
            if (entry.started)
              yield { type: 'tool_call_delta', id: entry.id, argumentsDelta: tc.function.arguments };
          }
        }
        if (choice.finish_reason) finish = mapFinish(choice.finish_reason);
      }
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
          cachedInputTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
          reasoningTokens: chunk.usage.completion_tokens_details?.reasoning_tokens ?? null,
          costUsd: typeof chunk.usage.cost === 'number' ? chunk.usage.cost : null,
        };
      }
    }
    for (const entry of calls.values()) {
      if (!entry.started) yield { type: 'tool_call_start', id: entry.id, name: entry.name };
      yield { type: 'tool_call_end', id: entry.id, name: entry.name, arguments: safeJson(entry.args) };
    }
    if (calls.size > 0 && finish === 'stop') finish = 'tool_calls';
    yield {
      type: 'usage',
      usage: usage ?? {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: null,
        costUsd: null,
      },
    };
    yield { type: 'finish', reason: finish };
  }
}

function mapFinish(reason: string): FinishReason {
  switch (reason) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'stop';
  }
}

function toOAITool(t: ToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  };
}

export function toOAIMessages(m: ChatMessage): OAIMessage[] {
  if (m.role === 'system') {
    const text = m.content
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n');
    return [{ role: 'system', content: text }];
  }
  if (m.role === 'tool') {
    return m.content
      .filter((p) => p.type === 'tool_result')
      .map((p) => ({ role: 'tool' as const, tool_call_id: p.toolCallId, content: p.content }));
  }
  if (m.role === 'assistant') {
    const text = m.content
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('');
    const toolCalls: OAIToolCall[] = m.content
      .filter((p) => p.type === 'tool_call')
      .map((p) => ({
        id: p.id,
        type: 'function',
        function: { name: p.name, arguments: JSON.stringify(p.arguments ?? {}) },
      }));
    const msg: OAIMessage = { role: 'assistant', content: text || null };
    if (toolCalls.length > 0) msg.tool_calls = toolCalls;
    return [msg];
  }
  // user: text and images; tool results that landed in a user message are emitted as tool messages
  const out: OAIMessage[] = [];
  const toolResults = m.content.filter((p) => p.type === 'tool_result');
  for (const tr of toolResults) out.push({ role: 'tool', tool_call_id: tr.toolCallId, content: tr.content });
  const parts: (OAITextContent | OAIImageContent)[] = [];
  for (const p of m.content) {
    if (p.type === 'text') parts.push({ type: 'text', text: p.text });
    else if (p.type === 'image')
      parts.push({ type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.data}` } });
  }
  if (parts.length === 1 && parts[0]?.type === 'text') out.push({ role: 'user', content: parts[0].text });
  else if (parts.length > 0) out.push({ role: 'user', content: parts });
  return out;
}
