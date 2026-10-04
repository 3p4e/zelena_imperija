import type { ProviderKind } from '@agent/shared';
import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  ContentPart,
  CredentialCheck,
  FinishReason,
  ModelInfo,
  StreamEvent,
  Usage,
} from './types.js';
import { ProviderError } from './errors.js';

export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: null,
  costUsd: null,
};

/**
 * Adapters implement `stream` and `listModels`; `chat` is derived by collecting
 * the stream so there is exactly one wire-protocol code path per vendor.
 */
export abstract class BaseProvider implements AIProvider {
  abstract readonly kind: ProviderKind;
  abstract stream(request: ChatRequest): AsyncIterable<StreamEvent>;
  abstract listModels(): Promise<ModelInfo[]>;

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return collectStream(this.stream(request));
  }

  async validateCredential(): Promise<CredentialCheck> {
    try {
      const models = await this.listModels();
      return { ok: true, message: `Credential accepted; ${models.length} models visible.`, modelsSeen: models.length };
    } catch (err) {
      if (err instanceof ProviderError) return { ok: false, message: err.message, modelsSeen: null };
      return { ok: false, message: 'Validation failed.', modelsSeen: null };
    }
  }
}

export async function collectStream(stream: AsyncIterable<StreamEvent>): Promise<ChatResponse> {
  const content: ContentPart[] = [];
  let text = '';
  let reasoning = '';
  const toolArgs = new Map<string, { name: string; buffer: string; done: boolean }>();
  let usage: Usage = EMPTY_USAGE;
  let finishReason: FinishReason = 'stop';

  const flushText = (): void => {
    if (text) content.push({ type: 'text', text });
    text = '';
  };
  const flushReasoning = (): void => {
    if (reasoning) content.push({ type: 'reasoning', text: reasoning });
    reasoning = '';
  };

  for await (const ev of stream) {
    switch (ev.type) {
      case 'text_delta':
        flushReasoning();
        text += ev.text;
        break;
      case 'reasoning_delta':
        reasoning += ev.text;
        break;
      case 'tool_call_start':
        flushReasoning();
        flushText();
        toolArgs.set(ev.id, { name: ev.name, buffer: '', done: false });
        break;
      case 'tool_call_delta': {
        const entry = toolArgs.get(ev.id);
        if (entry) entry.buffer += ev.argumentsDelta;
        break;
      }
      case 'tool_call_end': {
        const entry = toolArgs.get(ev.id);
        if (entry) entry.done = true;
        content.push({ type: 'tool_call', id: ev.id, name: ev.name, arguments: ev.arguments });
        break;
      }
      case 'usage':
        usage = ev.usage;
        break;
      case 'finish':
        finishReason = ev.reason;
        break;
    }
  }
  flushReasoning();
  flushText();
  for (const [id, entry] of toolArgs) {
    if (!entry.done) content.push({ type: 'tool_call', id, name: entry.name, arguments: safeJson(entry.buffer) });
  }
  return { content, usage, finishReason };
}

/** Unique id for tool calls whose provider did not supply one; ids must never repeat within a conversation. */
export function newToolCallId(): string {
  return `call_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function safeJson(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { __unparsed: text };
  }
}
