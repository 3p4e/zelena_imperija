import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  userDefaultsSchema,
  type AvailableModelOption,
  type CliKind,
  type CredentialMode,
} from '@agent/shared';
import { kindRequiresApiKey } from '@agent/providers';
import type { AppDeps } from '../../deps.js';
import {
  cliProviders,
  models,
  providers,
  sharedKeyGrantModels,
  sharedKeyGrants,
  userDefaults,
  userKeys,
  users,
} from '../../db/schema/index.js';
import { currentUser } from '../../auth/plugin.js';
import { parseBody } from '../../lib/validate.js';
import { modelDto } from '../dto.js';
import { assertModeAllowed } from '../projects/access.js';

export function registerProviderRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  app.get('/providers', async (req) => {
    const user = currentUser(req);
    const rows = await db
      .select()
      .from(providers)
      .where(eq(providers.enabled, true))
      .orderBy(asc(providers.displayName));
    return rows.map((p) => ({
      id: p.id,
      kind: p.kind,
      slug: p.slug,
      displayName: p.displayName,
      // Base URLs can point at private hosts (local Ollama); only the admin needs to see them.
      baseUrl: user.role === 'admin' ? p.baseUrl : null,
      enabled: p.enabled,
    }));
  });

  /** Models the current user can actually run, with the credential modes that would pay for each. */
  app.get('/models', async (req): Promise<AvailableModelOption[]> => {
    const user = currentUser(req);
    const rows = await db
      .select({ m: models, p: providers })
      .from(models)
      .innerJoin(providers, eq(providers.id, models.providerId))
      .where(and(eq(providers.enabled, true), eq(models.available, true)))
      .orderBy(asc(providers.displayName), asc(models.displayName));

    const ownKeys = await db
      .select({ providerId: userKeys.providerId })
      .from(userKeys)
      .where(and(eq(userKeys.userId, user.id), eq(userKeys.status, 'active')));
    const ownProviders = new Set(ownKeys.map((k) => k.providerId));

    const sharedModels = new Map<string, Set<string> | 'all'>();
    if (user.role === 'member') {
      const grants = await db
        .select({ grantId: sharedKeyGrants.id, providerId: userKeys.providerId })
        .from(sharedKeyGrants)
        .innerJoin(userKeys, eq(userKeys.id, sharedKeyGrants.userKeyId))
        .innerJoin(users, eq(users.id, userKeys.userId))
        .where(
          and(
            eq(sharedKeyGrants.memberUserId, user.id),
            eq(sharedKeyGrants.enabled, true),
            eq(userKeys.status, 'active'),
            eq(users.role, 'admin'),
          ),
        );
      for (const g of grants) {
        const allow = await db
          .select({ modelId: sharedKeyGrantModels.modelId })
          .from(sharedKeyGrantModels)
          .where(eq(sharedKeyGrantModels.grantId, g.grantId));
        const current = sharedModels.get(g.providerId);
        if (allow.length === 0 || current === 'all') sharedModels.set(g.providerId, 'all');
        else {
          const set = current ?? new Set<string>();
          for (const a of allow) set.add(a.modelId);
          sharedModels.set(g.providerId, set);
        }
      }
    }

    const out: AvailableModelOption[] = [];
    for (const { m, p } of rows) {
      const modes: CredentialMode[] = [];
      if (ownProviders.has(p.id) || (user.role === 'admin' && !kindRequiresApiKey(p.kind)))
        modes.push('byok');
      const s = sharedModels.get(p.id);
      const priced = m.inputPricePerMtok !== null && m.outputPricePerMtok !== null;
      if (priced && (s === 'all' || s?.has(m.id))) modes.push('shared');
      if (modes.length === 0 && user.role === 'member') continue;
      out.push({ model: modelDto(m, p), credentialModes: modes });
    }
    return out;
  });

  /** Subscription CLIs selectable in the model picker. Admin only; members always get an empty list. */
  app.get('/cli/options', async (req): Promise<{ kind: CliKind; loginState: string }[]> => {
    const user = currentUser(req);
    if (user.role !== 'admin' || !deps.cli.enabled) return [];
    const rows = await db.select().from(cliProviders).where(eq(cliProviders.enabled, true));
    return rows.map((r) => ({ kind: r.kind, loginState: r.loginState }));
  });

  app.get('/me/defaults', async (req) => {
    const user = currentUser(req);
    const row = await db.query.userDefaults.findFirst({ where: eq(userDefaults.userId, user.id) });
    return {
      defaultModelId: row?.defaultModelId ?? null,
      defaultCredentialMode: row?.defaultCredentialMode ?? null,
    };
  });

  app.put('/me/defaults', async (req) => {
    const user = currentUser(req);
    const body = parseBody(userDefaultsSchema, req.body);
    assertModeAllowed(user, body.defaultCredentialMode);
    if (body.defaultModelId) {
      const exists = await db
        .select({ id: models.id })
        .from(models)
        .where(inArray(models.id, [body.defaultModelId]));
      if (exists.length === 0) return { error: { code: 'validation_failed', message: 'Unknown model.' } };
    }
    await db
      .insert(userDefaults)
      .values({
        userId: user.id,
        defaultModelId: body.defaultModelId,
        defaultCredentialMode: body.defaultCredentialMode,
      })
      .onConflictDoUpdate({
        target: userDefaults.userId,
        set: { defaultModelId: body.defaultModelId, defaultCredentialMode: body.defaultCredentialMode },
      });
    return body;
  });
}
