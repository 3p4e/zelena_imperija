import pino, { type Logger } from 'pino';
import type { AppConfig } from '../config/env.js';

/** Paths that are always redacted from structured logs. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-goog-api-key"]',
  'res.headers["set-cookie"]',
  'apiKey',
  '*.apiKey',
  'password',
  '*.password',
  'token',
  '*.token',
  'secret',
  '*.secret',
  'env',
  '*.env',
  'ciphertext',
  '*.ciphertext',
];

export function createLogger(config: Pick<AppConfig, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  return pino({
    level: config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { service: 'agent-api' },
    ...(config.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  });
}
