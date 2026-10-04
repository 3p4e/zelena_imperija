/**
 * Error codes exposed to the frontend. Every API error response is
 * `{ error: { code, message, details? } }`. Stack traces never leave the server.
 */
export const API_ERROR_CODES = [
  'unauthenticated',
  'forbidden',
  'not_found',
  'validation_failed',
  'conflict',
  'rate_limited',
  'quota_exceeded',
  'safety_cap_reached',
  'provider_auth_failed',
  'provider_rate_limited',
  'provider_unavailable',
  'provider_timeout',
  'provider_bad_request',
  'model_unavailable',
  'credential_missing',
  'sandbox_unavailable',
  'sandbox_limit_reached',
  'execution_timeout',
  'cli_unavailable',
  'internal',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
  };
}
