import type { Logger } from 'pino';
import type { ProviderFactory } from '@agent/providers';
import type { AppConfig } from './config/env.js';
import type { Db } from './db/client.js';
import type { Mailer } from './lib/mailer.js';
import type { LoginThrottle, SessionService } from './auth/session.js';
import type { KeyVault } from './credentials/vault.js';
import type { SandboxManager } from './sandbox/manager.js';
import type { ToolRegistry } from './tools/registry.js';
import type { AgentRuntime } from './agent/runtime.js';
import type { CliRunner } from './cli/runner.js';

/** Everything route handlers need. Built once in main.ts and once per test suite. */
export interface AppDeps {
  config: AppConfig;
  db: Db;
  log: Logger;
  mailer: Mailer;
  sessions: SessionService;
  loginThrottle: LoginThrottle;
  vault: KeyVault;
  providerFactory: ProviderFactory;
  sandbox: SandboxManager;
  tools: ToolRegistry;
  agent: AgentRuntime;
  cli: CliRunner;
  audit: (
    actorUserId: string | null,
    action: string,
    targetType: string,
    targetId: string | null,
    ip?: string,
  ) => Promise<void>;
}
