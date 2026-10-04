import postgres from 'postgres';
import { runMigrations } from '../../src/db/migrate.js';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

/** Drops and recreates a dedicated database for one test file, then applies migrations. */
export async function freshDatabase(name: string): Promise<string> {
  const db = `agent_t_${name.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`;
  const sql = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
  try {
    await sql.unsafe(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await sql.unsafe(`CREATE DATABASE ${db}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
  const url = new URL(ADMIN_URL);
  url.pathname = `/${db}`;
  await runMigrations(url.toString());
  return url.toString();
}
