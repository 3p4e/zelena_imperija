/** Helpers to build `fetch` stubs that return SSE or JSON bodies for adapter tests. */

export function sseResponse(events: { event?: string; data: unknown }[], status = 200): Response {
  const text = events
    .map(
      (e) =>
        `${e.event ? `event: ${e.event}\n` : ''}data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`,
    )
    .join('');
  const encoder = new TextEncoder();
  // Split into uneven chunks to exercise the SSE buffer logic.
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < text.length; i += 37) chunks.push(encoder.encode(text.slice(i, i + 37)));
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.shift();
      if (next) controller.enqueue(next);
      else controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

export function errorResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Returns a fetch stub that serves the given responses in order and records each call. */
export function fetchSequence(responses: Response[]): { fetch: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const queue = [...responses];
  const fetchStub: typeof fetch = (input, init) => {
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h) {
      if (h instanceof Headers) h.forEach((v, k) => (headers[k.toLowerCase()] = v));
      else if (Array.isArray(h)) for (const [k, v] of h) headers[k.toLowerCase()] = v;
      else for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v;
    }
    let body: unknown = null;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      method: init?.method ?? 'GET',
      headers,
      body,
    });
    const next = queue.shift();
    if (!next) return Promise.reject(new Error('fetchSequence: no more responses'));
    return Promise.resolve(next);
  };
  return { fetch: fetchStub, calls };
}
