import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client.js';
import { runSeed } from './seed.js';
import { loadConfig } from '../config/env.js';
import { createLogger } from '../lib/logger.js';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export async function runMigrations(databaseUrl: string): Promise<void> {
  const handle = createDb(databaseUrl, { max: 1 });
  try {
    await migrate(handle.db, { migrationsFolder });
  } finally {
    await handle.close();
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config);
  await runMigrations(config.DATABASE_URL);
  log.info('migrations applied');
  const handle = createDb(config.DATABASE_URL, { max: 1 });
  try {
    const result = await runSeed(handle.db, config);
    log.info(result, 'seed applied');
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err: unknown) => {
    process.stderr.write(`migration failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
