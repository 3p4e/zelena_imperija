import type { ApiErrorBody, ApiErrorCode } from '@agent/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'network',
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    return new ApiError(res.status, body.error.code, body.error.message, body.error.details);
  } catch {
    return new ApiError(res.status, 'internal', `Request failed (${res.status}).`);
  }
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the server.');
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  put: <T>(p: string, b: unknown = {}) => request<T>('PUT', p, b),
  patch: <T>(p: string, b: unknown = {}) => request<T>('PATCH', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
};

/**
 * POSTs (or GETs when body is null) and invokes `onEvent` for each SSE `data:` frame
 * until the stream ends or `signal` aborts. Errors before the stream starts are thrown as ApiError.
 */
// The type parameter only types the parsed JSON frames handed to the caller.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export async function streamSse<E>(
  path: string,
  body: unknown,
  onEvent: (ev: E) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: body === null ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === null ? {} : { 'content-type': 'application/json' },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    if (signal?.aborted) return;
    throw err instanceof Error ? new ApiError(0, 'network', 'Cannot reach the server.') : err;
  }
  if (!res.ok) throw await parseError(res);
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of block.split('\n')) {
          if (line.startsWith('data: ')) onEvent(JSON.parse(line.slice(6)) as E);
        }
      }
    }
  } catch (err) {
    if (!signal?.aborted) throw err;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
