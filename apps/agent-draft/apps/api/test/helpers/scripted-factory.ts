import type { ProviderKind } from '@agent/shared';
import { ProviderError, type AIProvider, type ChatRequest, type ProviderConfig, type ProviderFactory } from '@agent/providers';
import { MockProvider, type MockTurn } from '@agent/providers/testing';

export interface FactoryCall {
  kind: ProviderKind;
  apiKey: string;
  baseUrl: string | undefined;
}

export interface RecordedRequest {
  kind: ProviderKind;
  apiKey: string;
  model: string;
  tools: string[];
  messages: ChatRequest['messages'];
}

/**
 * Test-only provider factory. Every request (across all provider instances)
 * consumes the next scripted turn; the last turn repeats. Each request is
 * recorded with the provider kind, API key and model it actually used.
 * Keys starting with "invalid-" are rejected the way a real provider would.
 */
export class ScriptedFactory {
  readonly calls: FactoryCall[] = [];
  readonly requests: RecordedRequest[] = [];
  private turns: MockTurn[] = [{ kind: 'text', text: 'ok' }];
  private cursor = 0;
  chunkDelayMs = 2;

  script(turns: MockTurn[]): void {
    this.turns = turns;
    this.cursor = 0;
  }

  private nextTurn(): MockTurn {
    const turn = this.turns[Math.min(this.cursor, this.turns.length - 1)];
    this.cursor++;
    if (!turn) throw new Error('no scripted turns');
    return turn;
  }

  readonly create: ProviderFactory = (kind: ProviderKind, config: ProviderConfig): AIProvider => {
    this.calls.push({ kind, apiKey: config.apiKey, baseUrl: config.baseUrl });
    const listing = new MockProvider({ turns: [{ kind: 'text', text: '' }] });
    if (config.apiKey.startsWith('invalid-')) return new RejectingProvider(kind);
    const next = (): MockTurn => this.nextTurn();
    const record = (req: ChatRequest): void => {
      this.requests.push({ kind, apiKey: config.apiKey, model: req.model, tools: (req.tools ?? []).map((t) => t.name), messages: req.messages });
    };
    const delay = (): number => this.chunkDelayMs;
    const provider: AIProvider = {
      kind,
      chat: (req) => new MockProvider({ turns: [next()] }).chat(req),
      async *stream(req) {
        record(req);
        yield* new MockProvider({ turns: [next()], chunkDelayMs: delay() }).stream(req);
      },
      listModels: () => listing.listModels(),
      validateCredential: () => listing.validateCredential(),
    };
    return provider;
  };

  lastRequest(): RecordedRequest | undefined {
    return this.requests[this.requests.length - 1];
  }
}

const rejected = (): ProviderError => new ProviderError('auth', 'Provider rejected the credential (401).', { status: 401, retryable: false });

class RejectingProvider implements AIProvider {
  constructor(readonly kind: ProviderKind) {}
  chat(): Promise<never> {
    return Promise.reject(rejected());
  }
  stream(): AsyncIterable<never> {
    return {
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(rejected()) }),
    };
  }
  listModels(): Promise<never> {
    return Promise.reject(rejected());
  }
  validateCredential(): Promise<{ ok: false; message: string; modelsSeen: null }> {
    return Promise.resolve({ ok: false, message: rejected().message, modelsSeen: null });
  }
}
