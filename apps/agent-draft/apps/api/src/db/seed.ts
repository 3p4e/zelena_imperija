import { eq } from 'drizzle-orm';
import argon2 from 'argon2';
import type { AppConfig } from '../config/env.js';
import type { Db } from './client.js';
import {
  PRIMARY_AGENT_TOOLS,
  PRIMARY_AGENT_SLUG,
  PRIMARY_AGENT_SYSTEM_PROMPT,
  SEED_PROVIDERS,
} from './seed-data.js';
import {
  agentDefinitionTools,
  agentDefinitions,
  cliProviders,
  globalSettings,
  models,
  providers,
  users,
} from './schema/index.js';
import { CLI_KINDS } from '@agent/shared';

export interface SeedResult {
  providersInserted: number;
  modelsInserted: number;
  adminCreated: boolean;
}

/** Idempotent: inserts what is missing, never overwrites admin edits. */
export async function runSeed(
  db: Db,
  config: Pick<AppConfig, 'ADMIN_EMAIL' | 'ADMIN_PASSWORD'>,
): Promise<SeedResult> {
  let providersInserted = 0;
  let modelsInserted = 0;

  for (const sp of SEED_PROVIDERS) {
    const existing = await db.query.providers.findFirst({ where: eq(providers.slug, sp.slug) });
    let providerId = existing?.id;
    if (!providerId) {
      const [row] = await db
        .insert(providers)
        .values({
          kind: sp.kind,
          slug: sp.slug,
          displayName: sp.displayName,
          baseUrl: sp.baseUrl ?? null,
          requiresKey: sp.requiresKey ?? true,
          enabled: true,
        })
        .returning({ id: providers.id });
      if (!row) throw new Error('failed to insert provider');
      providerId = row.id;
      providersInserted++;
    }
    for (const sm of sp.models) {
      const inserted = await db
        .insert(models)
        .values({
          providerId,
          modelId: sm.modelId,
          displayName: sm.displayName,
          contextWindow: sm.contextWindow,
          maxOutput: sm.maxOutput ?? null,
          inputPricePerMtok: sm.inputPricePerMtok?.toString() ?? null,
          outputPricePerMtok: sm.outputPricePerMtok?.toString() ?? null,
          cachedInputPricePerMtok: sm.cachedInputPricePerMtok?.toString() ?? null,
          supportsVision: sm.supportsVision,
          supportsTools: sm.supportsTools,
          supportsReasoning: sm.supportsReasoning,
          supportsStructuredOutput: sm.supportsStructuredOutput,
          available: sm.available,
          source: 'seed',
        })
        .onConflictDoNothing()
        .returning({ id: models.id });
      modelsInserted += inserted.length;
    }
  }

  await db
    .insert(globalSettings)
    .values({ id: 1, adminCapPerTaskUsd: '5', adminCapPerDayUsd: '50' })
    .onConflictDoNothing();

  const settings = await db.query.globalSettings.findFirst({ where: eq(globalSettings.id, 1) });
  if (settings && !settings.defaultModelId) {
    const anthropic = await db.query.providers.findFirst({ where: eq(providers.slug, 'anthropic') });
    const fallback = anthropic
      ? await db.query.models.findFirst({ where: eq(models.providerId, anthropic.id) })
      : await db.query.models.findFirst();
    if (fallback)
      await db.update(globalSettings).set({ defaultModelId: fallback.id }).where(eq(globalSettings.id, 1));
  }

  const agent = await db.query.agentDefinitions.findFirst({
    where: eq(agentDefinitions.slug, PRIMARY_AGENT_SLUG),
  });
  if (!agent) {
    const [row] = await db
      .insert(agentDefinitions)
      .values({
        slug: PRIMARY_AGENT_SLUG,
        displayName: 'Coding agent',
        roleDescription: 'Plans, edits files, runs commands and tests, iterates until the task is done.',
        systemPrompt: PRIMARY_AGENT_SYSTEM_PROMPT,
        maxIterations: 40,
        enabled: true,
        isPrimary: true,
      })
      .returning({ id: agentDefinitions.id });
    if (row) {
      await db
        .insert(agentDefinitionTools)
        .values(PRIMARY_AGENT_TOOLS.map((toolName) => ({ agentDefinitionId: row.id, toolName })))
        .onConflictDoNothing();
    }
  }

  for (const kind of CLI_KINDS) {
    await db.insert(cliProviders).values({ kind, enabled: false }).onConflictDoNothing();
  }

  let adminCreated = false;
  const existingAdmin = await db.query.users.findFirst({ where: eq(users.role, 'admin') });
  if (!existingAdmin && config.ADMIN_EMAIL && config.ADMIN_PASSWORD) {
    const passwordHash = await argon2.hash(config.ADMIN_PASSWORD, { type: argon2.argon2id });
    await db.insert(users).values({
      email: config.ADMIN_EMAIL.toLowerCase(),
      passwordHash,
      displayName: 'Admin',
      role: 'admin',
      status: 'active',
    });
    adminCreated = true;
  }

  return { providersInserted, modelsInserted, adminCreated };
}
