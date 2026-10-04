import type { ProviderKind } from '@agent/shared';
import { BaseProvider, safeJson } from '../base.js';
import { HttpClient } from '../http.js';
import { ProviderError } from '../errors.js';
import type {
  ChatMessage,
  ChatRequest,
  ContentPart,
  FinishReason,
  ModelInfo,
  ProviderConfig,
  StreamEvent,
  ToolDefinition,
} from '../types.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';
const STRUCTURED_TOOL_NAME = '__structured_output';

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}
interface AnthropicImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}
interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}
interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
type AnthropicBlock = AnthropicTextBlock | AnthropicImageBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicBlock[];
}

interface AnthropicModelsResponse {
  data: { id: string; display_name: string; created_at: string }[];
  has_more: boolean;
  last_id?: string;
}

type AnthropicStreamEvent =
  | { type: 'message_start'; message: { usage?: AnthropicUsage } }
  | {
      type: 'content_block_start';
      index: number;
      content_block: { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string } | { type: 'thinking' };
    }
  | {
      type: 'content_block_delta';
      index: number;
      delta:
        | { type: 'text_delta'; text: string }
        | { type: 'input_json_delta'; partial_json: string }
        | { type: 'thinking_delta'; thinking: string }
        | { type: 'signature_delta'; signature: string };
    }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string | null }; usage?: AnthropicUsage }
  | { type: 'message_stop' }
  | { type: 'ping' }
  | { type: 'error'; error: { type: string; message: string } };

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export class AnthropicProvider extends BaseProvider {
  readonly kind: ProviderKind = 'anthropic';
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
    return { 'x-api-key': this.apiKey, 'anthropic-version': API_VERSION };
  }

  async listModels(): Promise<ModelInfo[]> {
    const out: ModelInfo[] = [];
    let after: string | undefined;
    for (let page = 0; page < 10; page++) {
      const url = new URL(`${this.baseUrl}/v1/models`);
      url.searchParams.set('limit', '100');
      if (after) url.searchParams.set('after_id', after);
      const res = await this.http.json<AnthropicModelsResponse>(url.toString(), { method: 'GET', headers: this.headers() });
      for (const m of res.data) {
        out.push({
          modelId: m.id,
          displayName: m.display_name,
          contextWindow: null,
          maxOutput: null,
          inputPricePerMtok: null,
          outputPricePerMtok: null,
          cachedInputPricePerMtok: null,
          supportsVision: null,
          supportsTools: true,
          supportsReasoning: null,
        });
      }
      if (!res.has_more || !res.last_id) break;
      after = res.last_id;
    }
    return out;
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamEvent> {
    const body = buildAnthropicBody(request);
    const sse = this.http.sse(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body,
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
    });

    const blocks = new Map<number, { kind: 'text' | 'tool_use' | 'thinking'; id?: string; name?: string; json: string }>();
    let inputTokens = 0;
    let cached = 0;
    let outputTokens = 0;
    let finish: FinishReason = 'stop';
    const structured = request.structuredOutput !== undefined;

    for await (const msg of sse) {
      const ev = JSON.parse(msg.data) as AnthropicStreamEvent;
      switch (ev.type) {
        case 'message_start': {
          const u = ev.message.usage;
          inputTokens = u?.input_tokens ?? 0;
          cached = (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0);
          break;
        }
        case 'content_block_start': {
          const cb = ev.content_block;
          if (cb.type === 'tool_use') {
            blocks.set(ev.index, { kind: 'tool_use', id: cb.id, name: cb.name, json: '' });
            if (!(structured && cb.name === STRUCTURED_TOOL_NAME)) yield { type: 'tool_call_start', id: cb.id, name: cb.name };
          } else if (cb.type === 'thinking') {
            blocks.set(ev.index, { kind: 'thinking', json: '' });
          } else {
            blocks.set(ev.index, { kind: 'text', json: '' });
            if (cb.text) yield { type: 'text_delta', text: cb.text };
          }
          break;
        }
        case 'content_block_delta': {
          const block = blocks.get(ev.index);
          const d = ev.delta;
          if (d.type === 'text_delta') yield { type: 'text_delta', text: d.text };
          else if (d.type === 'thinking_delta') yield { type: 'reasoning_delta', text: d.thinking };
          else if (d.type === 'input_json_delta' && block?.kind === 'tool_use') {
            block.json += d.partial_json;
            if (structured && block.name === STRUCTURED_TOOL_NAME) yield { type: 'text_delta', text: d.partial_json };
            else if (block.id) yield { type: 'tool_call_delta', id: block.id, argumentsDelta: d.partial_json };
          }
          break;
        }
        case 'content_block_stop': {
          const block = blocks.get(ev.index);
          if (block?.kind === 'tool_use' && block.id && block.name && !(structured && block.name === STRUCTURED_TOOL_NAME)) {
            yield { type: 'tool_call_end', id: block.id, name: block.name, arguments: safeJson(block.json) };
          }
          break;
        }
        case 'message_delta': {
          outputTokens = ev.usage?.output_tokens ?? outputTokens;
          finish = mapStopReason(ev.delta.stop_reason, structured);
          break;
        }
        case 'error':
          throw new ProviderError(
            ev.error.type === 'overloaded_error' ? 'unavailable' : 'unknown',
            `Anthropic stream error: ${ev.error.message}`,
          );
        case 'message_stop':
        case 'ping':
          break;
      }
    }
    yield {
      type: 'usage',
      usage: {
        inputTokens,
        outputTokens,
        cachedInputTokens: cached,
        reasoningTokens: null,
        costUsd: null,
      },
    };
    yield { type: 'finish', reason: finish };
  }
}

function mapStopReason(reason: string | null, structured: boolean): FinishReason {
  switch (reason) {
    case 'tool_use':
      return structured ? 'stop' : 'tool_calls';
    case 'max_tokens':
      return 'length';
    case 'refusal':
      return 'content_filter';
    case 'end_turn':
    case 'stop_sequence':
    default:
      return 'stop';
  }
}

export function buildAnthropicBody(request: ChatRequest): Record<string, unknown> {
  const system = request.messages
    .filter((m) => m.role === 'system')
    .flatMap((m) => m.content)
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n\n');

  const messages = mergeAdjacent(request.messages.filter((m) => m.role !== 'system').map(toAnthropicMessage));

  const tools: Record<string, unknown>[] = (request.tools ?? []).map(toAnthropicTool);
  let toolChoice: Record<string, unknown> | undefined;
  if (request.structuredOutput) {
    tools.push({
      name: STRUCTURED_TOOL_NAME,
      description: `Return the final answer as JSON matching the schema named ${request.structuredOutput.name}.`,
      input_schema: request.structuredOutput.schema,
    });
    toolChoice = { type: 'tool', name: STRUCTURED_TOOL_NAME };
  } else if (request.toolChoice === 'required') toolChoice = { type: 'any' };
  else if (request.toolChoice === 'none') toolChoice = { type: 'none' };

  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: request.maxOutputTokens ?? 8192,
    messages,
    stream: true,
  };
  if (system) body.system = system;
  if (tools.length > 0) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;
  if (request.temperature !== undefined && !request.reasoningEffort) body.temperature = request.temperature;
  if (request.reasoningEffort) {
    const budget = { low: 2048, medium: 8192, high: 24576 }[request.reasoningEffort];
    body.thinking = { type: 'enabled', budget_tokens: budget };
    body.max_tokens = Math.max((request.maxOutputTokens ?? 8192) + budget, budget + 1024);
  }
  return body;
}

function toAnthropicTool(t: ToolDefinition): Record<string, unknown> {
  return { name: t.name, description: t.description, input_schema: t.inputSchema };
}

function toAnthropicMessage(m: ChatMessage): AnthropicMessage {
  const role: 'user' | 'assistant' = m.role === 'assistant' ? 'assistant' : 'user';
  const content: AnthropicBlock[] = [];
  for (const part of m.content) {
    switch (part.type) {
      case 'text':
        if (part.text) content.push({ type: 'text', text: part.text });
        break;
      case 'image':
        content.push({ type: 'image', source: { type: 'base64', media_type: part.mimeType, data: part.data } });
        break;
      case 'tool_call':
        content.push({ type: 'tool_use', id: part.id, name: part.name, input: part.arguments ?? {} });
        break;
      case 'tool_result':
        content.push({
          type: 'tool_result',
          tool_use_id: part.toolCallId,
          content: part.content,
          ...(part.isError ? { is_error: true } : {}),
        });
        break;
      case 'reasoning':
        // Reasoning blocks are not replayed; Anthropic requires signed thinking blocks for that.
        break;
    }
  }
  if (content.length === 0) content.push({ type: 'text', text: '(empty)' });
  return { role, content };
}

/** Anthropic requires strictly alternating roles; adjacent same-role messages are merged. */
function mergeAdjacent(messages: AnthropicMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last?.role === m.role) last.content.push(...m.content);
    else out.push({ role: m.role, content: [...m.content] });
  }
  return out;
}
