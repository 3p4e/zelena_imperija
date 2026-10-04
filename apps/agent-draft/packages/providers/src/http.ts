import { ProviderError, errorFromStatus, isAbortError } from './errors.js';

export interface HttpClientOptions {
  fetch?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
}

export interface SseMessage {
  event: string | null;
  data: string;
}

/**
 * Minimal HTTP client shared by all adapters: JSON requests, SSE streaming,
 * timeout and abort handling, and status→ProviderError mapping.
 */
export class HttpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly defaultTimeoutMs: number;

  constructor(opts: HttpClientOptions = {}) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.defaultTimeoutMs = opts.timeoutMs ?? 120_000;
  }

  async request(
    url: string,
    init: {
      method: 'GET' | 'POST';
      headers: Record<string, string>;
      body?: unknown;
      signal?: AbortSignal;
      timeoutMs?: number;
    },
  ): Promise<Response> {
    const signal = combineSignals(init.signal, init.timeoutMs ?? this.defaultTimeoutMs);
    let res: Response;
    try {
      const requestInit: RequestInit = { method: init.method, headers: init.headers, signal };
      if (init.body !== undefined) {
        requestInit.headers = { 'content-type': 'application/json', ...init.headers };
        requestInit.body = JSON.stringify(init.body);
      }
      res = await this.fetchImpl(url, requestInit);
    } catch (err) {
      if (isAbortError(err)) {
        if (init.signal?.aborted)
          throw new ProviderError('aborted', 'Request cancelled.', { retryable: false, cause: err });
        throw new ProviderError('timeout', 'Provider did not respond in time.', { cause: err });
      }
      throw new ProviderError('unavailable', 'Could not reach the provider.', { cause: err });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw errorFromStatus(res.status, text, res.headers.get('retry-after'));
    }
    return res;
  }

  async json<T>(url: string, init: Parameters<HttpClient['request']>[1]): Promise<T> {
    const res = await this.request(url, init);
    return (await res.json()) as T;
  }

  /** Issues a request and yields parsed SSE messages. */
  async *sse(url: string, init: Parameters<HttpClient['request']>[1]): AsyncGenerator<SseMessage> {
    const res = await this.request(url, {
      ...init,
      headers: { accept: 'text/event-stream', ...init.headers },
    });
    if (!res.body) throw new ProviderError('unavailable', 'Provider returned an empty stream.');
    yield* parseSse(res.body, init.signal);
  }
}

export async function* parseSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      if (signal?.aborted) throw new ProviderError('aborted', 'Request cancelled.', { retryable: false });
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const msg = parseSseBlock(raw);
        if (msg) yield msg;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const msg = parseSseBlock(buffer);
      if (msg) yield msg;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseBlock(raw: string): SseMessage | null {
  let event: string | null = null;
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  return { event, data: data.join('\n') };
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
