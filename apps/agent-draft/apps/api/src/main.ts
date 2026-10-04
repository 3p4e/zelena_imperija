import { loadConfig } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { runSeed } from './db/seed.js';
import { createDocker } from './sandbox/docker.js';
import { buildDeps } from './container.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config);
  await runMigrations(config.DATABASE_URL);
  const handle = createDb(config.DATABASE_URL);
  const seed = await runSeed(handle.db, config);
  if (seed.adminCreated) log.info({ email: config.ADMIN_EMAIL }, 'bootstrap admin created');

  const docker = createDocker(config.DOCKER_HOST);
  const deps = await buildDeps({ config, db: handle.db, log, docker });
  await deps.sandbox.reconcile();
  await deps.tools.loadMcpServers();
  const app = await buildApp(deps);

  const reaper = setInterval(() => {
    void deps.sandbox
      .reapIdle()
      .catch((err: unknown) => log.warn({ err: String(err) }, 'idle reaper failed'));
    void deps.sessions.purgeExpired().catch(() => undefined);
  }, 60_000);

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'shutting down');
    clearInterval(reaper);
    await app.close();
    await deps.tools.mcp.closeAll();
    await handle.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: config.HOST });
}

main().catch((err: unknown) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
