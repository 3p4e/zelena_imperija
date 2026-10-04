import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { CLI_KINDS, createSharedKeyGrantSchema, updateGlobalSettingsSchema, updateSharedKeyGrantSchema, type GlobalSettings, type SharedKeyGrant } from '@agent/shared';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { cliProviders, globalSettings, providers, sharedKeyGrantModels, sharedKeyGrants, toolCatalog, userKeys, users } from '../../db/schema/index.js';
import { currentUser } from '../../auth/plugin.js';
import { AppError, notFound } from '../../lib/errors.js';
import { parseBody, requireUuid } from '../../lib/validate.js';
import { spentOnGrantSince, startOfUtcDay, startOfUtcMonth } from '../../metering/usage.js';

const numOrNull = (v: string | null): number | null => (v === null ? null : Number(v));

export function registerAdminSettingsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  const readSettings = async (): Promise<GlobalSettings> => {
    const s = await db.query.globalSettings.findFirst({ where: eq(globalSettings.id, 1) });
    if (!s) throw new AppError('internal', 'Settings missing; run migrations.');
    return {
      defaultModelId: s.defaultModelId,
      adminSafetyCapEnabled: s.adminSafetyCapEnabled,
      adminCapPerTaskUsd: numOrNull(s.adminCapPerTaskUsd),
      adminCapPerDayUsd: numOrNull(s.adminCapPerDayUsd),
      adminSandboxCpu: s.adminSandboxCpu,
      adminSandboxMemMb: s.adminSandboxMemMb,
      adminSandboxDiskMb: s.adminSandboxDiskMb,
      adminMaxContainers: s.adminMaxContainers,
      memberSandboxCpu: s.memberSandboxCpu,
      memberSandboxMemMb: s.memberSandboxMemMb,
      memberSandboxDiskMb: s.memberSandboxDiskMb,
      memberMaxContainers: s.memberMaxContainers,
      containerIdleMinutes: s.containerIdleMinutes,
      commandTimeoutS: s.commandTimeoutS,
      agentMaxIterations: s.agentMaxIterations,
    };
  };

  app.get('/admin/settings', readSettings);

  app.put('/admin/settings', async (req) => {
    const admin = currentUser(req);
    const body = parseBody(updateGlobalSettingsSchema, req.body);
    const { adminCapPerTaskUsd, adminCapPerDayUsd, ...rest } = body;
    await db
      .update(globalSettings)
      .set({
        ...rest,
        ...(adminCapPerTaskUsd !== undefined ? { adminCapPerTaskUsd: adminCapPerTaskUsd === null ? null : String(adminCapPerTaskUsd) } : {}),
        ...(adminCapPerDayUsd !== undefined ? { adminCapPerDayUsd: adminCapPerDayUsd === null ? null : String(adminCapPerDayUsd) } : {}),
      })
      .where(eq(globalSettings.id, 1));
    await deps.audit(admin.id, 'admin.settings_update', 'settings', '1', req.ip);
    return readSettings();
  });

  const grantDto = async (g: typeof sharedKeyGrants.$inferSelect): Promise<SharedKeyGrant> => {
    const [meta] = await db
      .select({ label: userKeys.label, slug: providers.slug, email: users.email })
      .from(userKeys)
      .innerJoin(providers, eq(providers.id, userKeys.providerId))
      .innerJoin(users, eq(users.id, g.memberUserId))
      .where(eq(userKeys.id, g.userKeyId));
    const allowed = await db.select({ modelId: sharedKeyGrantModels.modelId }).from(sharedKeyGrantModels).where(eq(sharedKeyGrantModels.grantId, g.id));
    return {
      id: g.id,
      userKeyId: g.userKeyId,
      keyLabel: meta?.label ?? '',
      providerSlug: meta?.slug ?? '',
      memberUserId: g.memberUserId,
      memberEmail: meta?.email ?? '',
      dailyLimitUsd: Number(g.dailyLimitUsd),
      monthlyLimitUsd: Number(g.monthlyLimitUsd),
      enabled: g.enabled,
      allowedModelIds: allowed.map((a) => a.modelId),
      spentTodayUsd: await spentOnGrantSince(db, g.id, startOfUtcDay()),
      spentMonthUsd: await spentOnGrantSince(db, g.id, startOfUtcMonth()),
    };
  };

  app.get('/admin/shared-grants', async () => {
    const rows = await db.select().from(sharedKeyGrants);
    return Promise.all(rows.map(grantDto));
  });

  app.post('/admin/shared-grants', async (req, reply) => {
    const admin = currentUser(req);
    const body = parseBody(createSharedKeyGrantSchema, req.body);
    const key = await db.query.userKeys.findFirst({ where: and(eq(userKeys.id, body.userKeyId), eq(userKeys.userId, admin.id)) });
    if (!key || key.status === 'revoked') throw new AppError('validation_failed', 'Pick one of your own active keys to share.');
    const member = await db.query.users.findFirst({ where: eq(users.id, body.memberUserId) });
    if (member?.role !== 'member') throw new AppError('validation_failed', 'Shared keys can only be granted to members.');
    const [row] = await db
      .insert(sharedKeyGrants)
      .values({ userKeyId: key.id, memberUserId: member.id, dailyLimitUsd: String(body.dailyLimitUsd), monthlyLimitUsd: String(body.monthlyLimitUsd), enabled: body.enabled })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new AppError('conflict', 'This member already has a grant on that key.');
    if (body.allowedModelIds.length > 0) await db.insert(sharedKeyGrantModels).values(body.allowedModelIds.map((modelId) => ({ grantId: row.id, modelId })));
    await deps.audit(admin.id, 'admin.grant_create', 'grant', row.id, req.ip);
    return reply.code(201).send(await grantDto(row));
  });

  app.patch('/admin/shared-grants/:id', async (req) => {
    const id = requireUuid((req.params as { id: string }).id);
    const body = parseBody(updateSharedKeyGrantSchema, req.body);
    const grant = await db.query.sharedKeyGrants.findFirst({ where: eq(sharedKeyGrants.id, id) });
    if (!grant) throw notFound('Grant');
    await db
      .update(sharedKeyGrants)
      .set({
        ...(body.dailyLimitUsd !== undefined ? { dailyLimitUsd: String(body.dailyLimitUsd) } : {}),
        ...(body.monthlyLimitUsd !== undefined ? { monthlyLimitUsd: String(body.monthlyLimitUsd) } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      })
      .where(eq(sharedKeyGrants.id, id));
    if (body.allowedModelIds !== undefined) {
      await db.delete(sharedKeyGrantModels).where(eq(sharedKeyGrantModels.grantId, id));
      if (body.allowedModelIds.length > 0) await db.insert(sharedKeyGrantModels).values(body.allowedModelIds.map((modelId) => ({ grantId: id, modelId })));
    }
    const updated = await db.query.sharedKeyGrants.findFirst({ where: eq(sharedKeyGrants.id, id) });
    if (!updated) throw notFound('Grant');
    return grantDto(updated);
  });

  app.delete('/admin/shared-grants/:id', async (req) => {
    const id = requireUuid((req.params as { id: string }).id);
    await db.delete(sharedKeyGrants).where(eq(sharedKeyGrants.id, id));
    return { ok: true };
  });

  app.patch('/admin/tools/:name', async (req) => {
    const name = (req.params as { name: string }).name;
    const body = parseBody(z.object({ enabled: z.boolean() }), req.body);
    const rows = await db.update(toolCatalog).set({ enabled: body.enabled }).where(eq(toolCatalog.name, name)).returning({ name: toolCatalog.name });
    if (rows.length === 0) throw notFound('Tool');
    return { name, enabled: body.enabled };
  });

  app.get('/admin/cli', async () => Promise.all(CLI_KINDS.map((k) => deps.cli.status(k))));

  app.patch('/admin/cli/:kind', async (req) => {
    const kind = parseBody(z.enum(CLI_KINDS), (req.params as { kind: string }).kind);
    const body = parseBody(z.object({ enabled: z.boolean() }), req.body);
    await db.update(cliProviders).set({ enabled: body.enabled }).where(inArray(cliProviders.kind, [kind]));
    return deps.cli.status(kind);
  });

  app.post('/admin/cli/:kind/check', async (req) => {
    const kind = parseBody(z.enum(CLI_KINDS), (req.params as { kind: string }).kind);
    return deps.cli.check(kind);
  });
}
