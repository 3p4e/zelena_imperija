import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { usageQuerySchema, type UsageRecord, type UsageSummary } from '@agent/shared';
import type { AppDeps } from '../../deps.js';
import type { Db } from '../../db/client.js';
import { usageRecords, users } from '../../db/schema/index.js';
import { currentUser, requireAdmin } from '../../auth/plugin.js';
import { parseBody, requireUuid } from '../../lib/validate.js';
import { projectFor } from '../projects/access.js';

export async function summarize(db: Db, where: SQL | undefined): Promise<UsageSummary> {
  const cost = sql<string>`coalesce(sum(${usageRecords.estimatedCostUsd}), 0)`;
  const [totals] = await db
    .select({
      requests: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${usageRecords.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${usageRecords.outputTokens}), 0)::int`,
      cost,
    })
    .from(usageRecords)
    .where(where);
  const byModel = await db
    .select({
      providerSlug: usageRecords.providerSlug,
      modelId: usageRecords.modelId,
      requests: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${usageRecords.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${usageRecords.outputTokens}), 0)::int`,
      cost,
    })
    .from(usageRecords)
    .where(where)
    .groupBy(usageRecords.providerSlug, usageRecords.modelId)
    .orderBy(desc(cost));
  const day = sql<string>`to_char(date_trunc('day', ${usageRecords.at} at time zone 'UTC'), 'YYYY-MM-DD')`;
  const byDay = await db
    .select({ day, requests: sql<number>`count(*)::int`, cost })
    .from(usageRecords)
    .where(where)
    .groupBy(day)
    .orderBy(day);
  return {
    requests: totals?.requests ?? 0,
    inputTokens: totals?.inputTokens ?? 0,
    outputTokens: totals?.outputTokens ?? 0,
    estimatedCostUsd: Number(totals?.cost ?? 0),
    byModel: byModel.map((r) => ({ ...r, estimatedCostUsd: Number(r.cost) })),
    byDay: byDay.map((r) => ({ day: r.day, requests: r.requests, estimatedCostUsd: Number(r.cost) })),
  };
}

function rangeFilters(q: { from?: string | undefined; to?: string | undefined }): SQL[] {
  const f: SQL[] = [];
  if (q.from) f.push(gte(usageRecords.at, new Date(q.from)));
  if (q.to) f.push(lte(usageRecords.at, new Date(q.to)));
  return f;
}

function recordDto(r: typeof usageRecords.$inferSelect): UsageRecord {
  return {
    id: r.id,
    userId: r.userId,
    projectId: r.projectId,
    conversationId: r.conversationId,
    providerSlug: r.providerSlug,
    modelId: r.modelId,
    credentialSource: r.credentialSource,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cachedInputTokens: r.cachedInputTokens,
    reasoningTokens: r.reasoningTokens,
    estimatedCostUsd: r.estimatedCostUsd === null ? null : Number(r.estimatedCostUsd),
    durationMs: r.durationMs,
    status: r.status,
    errorCode: r.errorCode,
    at: r.at.toISOString(),
  };
}

export function registerUsageRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  /** Own usage; with projectId, the owner sees everyone's usage in that project, others see their own. */
  const scope = async (req: Parameters<typeof currentUser>[0]): Promise<SQL[]> => {
    const user = currentUser(req);
    const q = parseBody(usageQuerySchema, req.query);
    const filters = rangeFilters(q);
    if (q.projectId) {
      const { permission } = await projectFor(db, user, q.projectId, 'read');
      filters.push(eq(usageRecords.projectId, q.projectId));
      if (permission !== 'owner') filters.push(eq(usageRecords.userId, user.id));
    } else {
      filters.push(eq(usageRecords.userId, user.id));
    }
    return filters;
  };

  app.get('/usage/summary', async (req) => summarize(db, and(...(await scope(req)))));

  app.get('/usage/records', async (req) => {
    const rows = await db
      .select()
      .from(usageRecords)
      .where(and(...(await scope(req))))
      .orderBy(desc(usageRecords.at))
      .limit(200);
    return rows.map(recordDto);
  });

  app.get('/admin/usage/summary', { preHandler: requireAdmin }, async (req) => {
    const q = parseBody(usageQuerySchema, req.query);
    const filters = rangeFilters(q);
    if (q.userId) filters.push(eq(usageRecords.userId, requireUuid(q.userId)));
    return summarize(db, filters.length > 0 ? and(...filters) : undefined);
  });

  app.get('/admin/usage/users', { preHandler: requireAdmin }, async (req) => {
    const q = parseBody(usageQuerySchema, req.query);
    const filters = rangeFilters(q);
    const rows = await db
      .select({
        userId: users.id,
        email: users.email,
        requests: sql<number>`count(${usageRecords.id})::int`,
        inputTokens: sql<number>`coalesce(sum(${usageRecords.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${usageRecords.outputTokens}), 0)::int`,
        cost: sql<string>`coalesce(sum(${usageRecords.estimatedCostUsd}), 0)`,
        blocked: sql<number>`count(*) filter (where ${usageRecords.status} in ('blocked_quota','blocked_cap'))::int`,
      })
      .from(users)
      .leftJoin(
        usageRecords,
        filters.length > 0
          ? and(eq(usageRecords.userId, users.id), ...filters)
          : eq(usageRecords.userId, users.id),
      )
      .groupBy(users.id, users.email)
      .orderBy(users.email);
    return rows.map((r) => ({ ...r, estimatedCostUsd: Number(r.cost) }));
  });
}
