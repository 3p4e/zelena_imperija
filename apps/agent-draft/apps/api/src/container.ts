import type Docker from 'dockerode';
import type { Logger } from 'pino';
import { createProvider, type ProviderFactory } from '@agent/providers';
import type { AppConfig } from './config/env.js';
import type { Db } from './db/client.js';
import type { AppDeps } from './deps.js';
import { auditLog } from './db/schema/index.js';
import { LoginThrottle, SessionService } from './auth/session.js';
import { KeyVault } from './credentials/vault.js';
import { createMailer, type Mailer } from './lib/mailer.js';
import { SandboxManager } from './sandbox/manager.js';
import { ToolRegistry } from './tools/registry.js';
import { registerBuiltinTools } from './tools/builtin/index.js';
import { AgentRuntime } from './agent/runtime.js';
import { DockerCliRunner, type CliRunner } from './cli/runner.js';

export interface BuildDepsOptions {
  config: AppConfig;
  db: Db;
  log: Logger;
  docker: Docker;
  /** Tests inject a mock provider factory; production uses the real adapters. */
  providerFactory?: ProviderFactory;
  mailer?: Mailer;
  cli?: CliRunner;
}

/** Wires all services. The only place where concrete implementations are chosen. */
export async function buildDeps(opts: BuildDepsOptions): Promise<AppDeps> {
  const { config, db, log, docker } = opts;
  const vault = new KeyVault(db, config.MASTER_KEY, config.MASTER_KEY_VERSION);
  const sandbox = new SandboxManager(db, docker, config, log.child({ mod: 'sandbox' }));
  const tools = new ToolRegistry(db, vault, log.child({ mod: 'tools' }));
  registerBuiltinTools(tools, sandbox, db);
  const providerFactory = opts.providerFactory ?? createProvider;
  const cli = opts.cli ?? new DockerCliRunner(db, docker, sandbox, config, log.child({ mod: 'cli' }));
  const agent = new AgentRuntime({ db, vault, providerFactory, tools, cli, config, log: log.child({ mod: 'agent' }) });
  await tools.syncCatalog();
  return {
    config,
    db,
    log,
    mailer: opts.mailer ?? createMailer(config, log),
    sessions: new SessionService(db, config.SESSION_TTL_HOURS),
    loginThrottle: new LoginThrottle(db, config.LOGIN_RATE_LIMIT_MAX, config.LOGIN_RATE_LIMIT_WINDOW_MIN),
    vault,
    providerFactory,
    sandbox,
    tools,
    agent,
    cli,
    audit: async (actorUserId, action, targetType, targetId, ip) => {
      await db.insert(auditLog).values({ actorUserId, action, targetType, targetId, ip: ip ?? null });
    },
  };
}
