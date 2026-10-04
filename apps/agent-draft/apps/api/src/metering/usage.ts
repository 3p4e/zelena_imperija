import { and, eq, gte, sql } from 'drizzle-orm';
import type { CredentialMode, UsageStatus } from '@agent/shared';
import type { Db, Tx } from '../db/client.js';
import { usageRecords } from '../db/schema/index.js';

export interface UsageInput {
  userId: string;
  projectId: string | null;
  conversationId: string | null;
  messageId: string | null;
  providerId: string | null;
  providerSlug: string;
  modelRef: string | null;
  modelId: string;
  credentialSource: CredentialMode;
  userKeyId: string | null;
  sharedKeyGrantId: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number | null;
  estimatedCostUsd: number | null;
  durationMs: number;
  status: UsageStatus;
  errorCode: string | null;
}

export async function recordUsage(db: Db | Tx, input: UsageInput): Promise<void> {
  await db.insert(usageRecords).values({
    ...input,
    estimatedCostUsd: input.estimatedCostUsd === null ? null : input.estimatedCostUsd.toFixed(8),
  });
}

export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
export function startOfUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function spentOnGrantSince(db: Db | Tx, grantId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ total: sql<string | null>`coalesce(sum(${usageRecords.estimatedCostUsd}), 0)` })
    .from(usageRecords)
    .where(and(eq(usageRecords.sharedKeyGrantId, grantId), gte(usageRecords.at, since)));
  return Number(row?.total ?? 0);
}

export async function spentByUserSince(db: Db | Tx, userId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ total: sql<string | null>`coalesce(sum(${usageRecords.estimatedCostUsd}), 0)` })
    .from(usageRecords)
    .where(and(eq(usageRecords.userId, userId), gte(usageRecords.at, since)));
  return Number(row?.total ?? 0);
}
