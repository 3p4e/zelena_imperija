import type { ApiErrorBody, ApiErrorCode } from '@agent/shared';
import { ProviderError } from '@agent/providers';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 400,
  conflict: 409,
  rate_limited: 429,
  quota_exceeded: 402,
  safety_cap_reached: 402,
  provider_auth_failed: 502,
  provider_rate_limited: 503,
  provider_unavailable: 503,
  provider_timeout: 504,
  provider_bad_request: 502,
  model_unavailable: 400,
  credential_missing: 400,
  sandbox_unavailable: 503,
  sandbox_limit_reached: 429,
  execution_timeout: 504,
  cli_unavailable: 503,
  internal: 500,
};

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  readonly retryable: boolean;

  constructor(code: ApiErrorCode, message: string, details?: Record<string, unknown>, retryable = false) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
    this.retryable = retryable;
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
        ...(this.retryable ? { retryable: true } : {}),
      },
    };
  }
}

export const notFound = (what = 'Resource'): AppError => new AppError('not_found', `${what} not found.`);
export const forbidden = (msg = 'You do not have access to this resource.'): AppError => new AppError('forbidden', msg);
export const unauthenticated = (): AppError => new AppError('unauthenticated', 'Authentication required.');

/** Maps a normalised provider failure to a user-facing API error. */
export function fromProviderError(err: ProviderError): AppError {
  switch (err.code) {
    case 'auth':
      return new AppError('provider_auth_failed', `The provider rejected the API key. Check the key in Settings. (${err.message})`);
    case 'rate_limited':
      return new AppError('provider_rate_limited', `The provider is rate-limiting requests. ${err.message}`, undefined, true);
    case 'unavailable':
      return new AppError('provider_unavailable', `The provider is unavailable. ${err.message}`, undefined, true);
    case 'timeout':
      return new AppError('provider_timeout', 'The provider did not answer in time.', undefined, true);
    case 'model_not_found':
      return new AppError('model_unavailable', err.message);
    case 'bad_request':
      return new AppError('provider_bad_request', err.message);
    case 'content_filter':
      return new AppError('provider_bad_request', 'The provider refused the request on content grounds.');
    case 'aborted':
      return new AppError('internal', 'Request cancelled.');
    case 'unknown':
      return new AppError('provider_unavailable', err.message, undefined, true);
  }
}

export function isProviderError(err: unknown): err is ProviderError {
  return err instanceof ProviderError;
}
