export type ProviderErrorCode =
  | 'auth'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'bad_request'
  | 'model_not_found'
  | 'content_filter'
  | 'aborted'
  | 'unknown';

/**
 * Normalised provider failure. `message` is safe to show to users: it never
 * contains credentials, and vendor text is truncated.
 */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(
    code: ProviderErrorCode,
    message: string,
    opts: {
      status?: number | undefined;
      retryable?: boolean;
      retryAfterMs?: number | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(sanitize(message), { cause: opts.cause });
    this.name = 'ProviderError';
    this.code = code;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
    this.retryable =
      opts.retryable ?? (code === 'rate_limited' || code === 'unavailable' || code === 'timeout');
  }
}

const KEY_PATTERNS = [/sk-[A-Za-z0-9_-]{8,}/g, /AIza[0-9A-Za-z_-]{20,}/g, /Bearer\s+[A-Za-z0-9._-]{8,}/gi];

export function sanitize(text: string): string {
  let out = text;
  for (const p of KEY_PATTERNS) out = out.replace(p, '[redacted]');
  return out.length > 500 ? `${out.slice(0, 500)}…` : out;
}

export function errorFromStatus(
  status: number,
  bodyText: string,
  retryAfterHeader?: string | null,
): ProviderError {
  const snippet = extractMessage(bodyText);
  const retryAfterMs = parseRetryAfter(retryAfterHeader);
  if (status === 401 || status === 403) {
    return new ProviderError('auth', `Provider rejected the credential (${status}). ${snippet}`.trim(), {
      status,
      retryable: false,
    });
  }
  if (status === 404) {
    return new ProviderError('model_not_found', `Model or endpoint not found (404). ${snippet}`.trim(), {
      status,
      retryable: false,
    });
  }
  if (status === 429) {
    return new ProviderError('rate_limited', `Provider rate limit reached. ${snippet}`.trim(), {
      status,
      retryAfterMs,
    });
  }
  if (status === 408 || status === 504) {
    return new ProviderError('timeout', `Provider timed out (${status}). ${snippet}`.trim(), { status });
  }
  if (status >= 500) {
    return new ProviderError('unavailable', `Provider unavailable (${status}). ${snippet}`.trim(), {
      status,
    });
  }
  if (status === 400 || status === 422) {
    return new ProviderError('bad_request', `Provider rejected the request (${status}). ${snippet}`.trim(), {
      status,
      retryable: false,
    });
  }
  return new ProviderError('unknown', `Unexpected provider response (${status}). ${snippet}`.trim(), {
    status,
  });
}

function extractMessage(bodyText: string): string {
  if (!bodyText) return '';
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (parsed && typeof parsed === 'object') {
      const err = (parsed as { error?: unknown }).error;
      if (typeof err === 'string') return err;
      if (err && typeof err === 'object') {
        const m = (err as { message?: unknown }).message;
        if (typeof m === 'string') return m;
      }
      const m = (parsed as { message?: unknown }).message;
      if (typeof m === 'string') return m;
    }
  } catch {
    /* not JSON */
  }
  return bodyText.slice(0, 200);
}

function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}
