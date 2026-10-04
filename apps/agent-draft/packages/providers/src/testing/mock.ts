import type { ProviderKind } from '@agent/shared';
import { BaseProvider, newToolCallId } from '../base.js';
import { ProviderError } from '../errors.js';
import type { ChatRequest, ModelInfo, StreamEvent, Usage } from '../types.js';

export type MockTurn =
  | { kind: 'text'; text: string; usage?: Partial<Usage> }
  | {
      kind: 'tool_call';
      name: string;
      arguments: Record<string, unknown>;
      text?: string;
      usage?: Partial<Usage>;
    }
  | { kind: 'error'; code: ConstructorParameters<typeof ProviderError>[0]; message: string; status?: number };

export interface MockScript {
  /** Turns consumed in order; the last one repeats when exhausted. */
  turns: MockTurn[];
  /** Delay between streamed chunks, ms (keeps streaming observable in E2E). */
  chunkDelayMs?: number;
  models?: ModelInfo[];
}

export interface RecordedRequest {
  model: string;
  messages: ChatRequest['messages'];
  tools: string[];
}

/**
 * Deterministic provider for tests. Behaves like a real adapter from the
 * runtime's point of view: streams text in chunks, emits tool calls, reports
 * usage, and can fail with a typed ProviderError.
 */
export class MockProvider extends BaseProvider {
  readonly kind: ProviderKind = 'openai_compatible';
  readonly requests: RecordedRequest[] = [];
  private cursor = 0;

  constructor(private readonly script: MockScript) {
    super();
  }

  listModels(): Promise<ModelInfo[]> {
    return Promise.resolve(
      this.script.models ?? [
        {
          modelId: 'mock-1',
          displayName: 'Mock 1',
          contextWindow: 128_000,
          maxOutput: 8192,
          inputPricePerMtok: 1,
          outputPricePerMtok: 2,
          cachedInputPricePerMtok: null,
          supportsVision: false,
          supportsTools: true,
          supportsReasoning: false,
        },
      ],
    );
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamEvent> {
    this.requests.push({
      model: request.model,
      messages: request.messages,
      tools: (request.tools ?? []).map((t) => t.name),
    });
    const turn = this.script.turns[Math.min(this.cursor, this.script.turns.length - 1)];
    this.cursor++;
    if (!turn) throw new ProviderError('unknown', 'Mock script has no turns.');
    if (turn.kind === 'error') {
      // Retryability follows the error code, exactly like the real adapters.
      throw new ProviderError(turn.code, turn.message, { status: turn.status });
    }
    const delay = this.script.chunkDelayMs ?? 0;
    const text = turn.kind === 'text' ? turn.text : (turn.text ?? '');
    for (const chunk of chunkString(text, 12)) {
      request.signal?.throwIfAborted();
      if (delay > 0) await sleep(delay);
      yield { type: 'text_delta', text: chunk };
    }
    if (turn.kind === 'tool_call') {
      const id = newToolCallId();
      yield { type: 'tool_call_start', id, name: turn.name };
      yield { type: 'tool_call_delta', id, argumentsDelta: JSON.stringify(turn.arguments) };
      yield { type: 'tool_call_end', id, name: turn.name, arguments: turn.arguments };
    }
    const usage: Usage = {
      inputTokens: 100,
      outputTokens: Math.max(1, Math.ceil(text.length / 4)),
      cachedInputTokens: 0,
      reasoningTokens: null,
      costUsd: null,
      ...turn.usage,
    };
    yield { type: 'usage', usage };
    yield { type: 'finish', reason: turn.kind === 'tool_call' ? 'tool_calls' : 'stop' };
  }
}

function* chunkString(s: string, size: number): Generator<string> {
  for (let i = 0; i < s.length; i += size) yield s.slice(i, i + size);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
