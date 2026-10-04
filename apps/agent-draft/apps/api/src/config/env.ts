import { z } from 'zod';

const boolString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  /** Public origin of the app, used for invite/reset links and cookie security. */
  PUBLIC_URL: z.url().default('http://localhost:8080'),
  /** Comma-separated extra CORS origins (the dev Vite server, for example). */
  CORS_ORIGINS: z.string().default(''),
  DATABASE_URL: z.string().min(1),
  /** 32 bytes, base64. Wraps per-user data-encryption keys. */
  MASTER_KEY: z.string().min(40),
  MASTER_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).default(24 * 14),
  /** Reject non-HTTPS requests that are not on localhost. */
  REQUIRE_HTTPS: boolString.default(true),
  /** Trust X-Forwarded-* from the reverse proxy. */
  TRUST_PROXY: boolString.default(true),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  LOGIN_RATE_LIMIT_WINDOW_MIN: z.coerce.number().int().min(1).default(15),

  /** Bootstrap admin, applied only when no admin exists. */
  ADMIN_EMAIL: z.email().optional(),
  ADMIN_PASSWORD: z.string().min(10).optional(),

  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  DOCKER_HOST: z.string().default('unix:///var/run/docker.sock'),
  SANDBOX_IMAGE: z.string().default('agent-sandbox-base:latest'),
  /** Docker runtime for sandboxes, e.g. runc or runsc (gVisor). */
  SANDBOX_RUNTIME: z.string().default('runc'),
  /** Prefix for sandbox resources so the manager can find and clean them. */
  SANDBOX_PREFIX: z.string().default('agent-sbx'),
  /**
   * Name of the API's own container when running under compose. The API joins each
   * user's sandbox network at .254 so the preview proxy can reach sandbox ports.
   * Leave empty when the API runs directly on the Docker host (it then routes to bridges itself).
   */
  SANDBOX_API_CONTAINER: z.string().optional(),
  /** Hours a signed preview URL stays valid. */
  PREVIEW_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),

  /** Enables admin-only subscription mode through the official vendor CLIs. */
  CLI_RUNNER_ENABLED: boolString.default(false),
  /** Image containing the unmodified claude, codex and gemini binaries (infra/cli-runner). */
  CLI_RUNNER_IMAGE: z.string().default('agent-cli-runner:latest'),
  /** Volume holding the admin's own CLI login state (~/.claude, ~/.codex, ~/.gemini). */
  CLI_HOME_VOLUME: z.string().default('agent-cli-home'),
  /** Max wall-clock seconds for one CLI run. */
  CLI_RUN_TIMEOUT_S: z.coerce.number().int().min(30).max(7200).default(1800),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}

export function corsOrigins(config: AppConfig): string[] {
  const list = config.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [config.PUBLIC_URL, ...list];
}
