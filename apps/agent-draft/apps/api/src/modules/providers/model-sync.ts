import { and, eq, inArray, notInArray } from 'drizzle-orm';
import type { ModelInfo } from '@agent/providers';
import type { Db } from '../../db/client.js';
import { models } from '../../db/schema/index.js';

const priceStr = (n: number | null | undefined): string | null =>
  n === null || n === undefined ? null : String(n);

export interface ModelSyncResult {
  added: number;
  updated: number;
  retired: number;
  total: number;
}

/**
 * Upserts a provider's live model list into the registry. `retire` marks
 * previously-known seed/fetched models that the provider no longer returns as
 * unavailable — safe for an explicit admin refresh, but not for an automatic
 * sync, where a thin or rate-limited response must never hide working models.
 * Admin price edits (source 'manual') are never touched.
 */
export async function syncProviderModels(
  db: Db,
  providerId: string,
  listed: ModelInfo[],
  opts: { retire: boolean },
): Promise<ModelSyncResult> {
  let added = 0;
  let updated = 0;
  for (const m of listed) {
    const existing = await db.query.models.findFirst({
      where: and(eq(models.providerId, providerId), eq(models.modelId, m.modelId)),
    });
    if (!existing) {
      await db.insert(models).values({
        providerId,
        modelId: m.modelId,
        displayName: m.displayName,
        contextWindow: m.contextWindow ?? 128_000,
        maxOutput: m.maxOutput,
        inputPricePerMtok: priceStr(m.inputPricePerMtok),
        outputPricePerMtok: priceStr(m.outputPricePerMtok),
        cachedInputPricePerMtok: priceStr(m.cachedInputPricePerMtok),
        supportsVision: m.supportsVision ?? false,
        supportsTools: m.supportsTools ?? true,
        supportsReasoning: m.supportsReasoning ?? false,
        available: true,
        source: 'fetched',
        lastFetchedAt: new Date(),
      });
      added++;
    } else {
      await db
        .update(models)
        .set({
          available: true,
          lastFetchedAt: new Date(),
          ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
          ...(m.maxOutput ? { maxOutput: m.maxOutput } : {}),
          // Prices are only filled from the vendor when it publishes them, and never over an admin edit.
          ...(m.inputPricePerMtok !== null ? { inputPricePerMtok: String(m.inputPricePerMtok) } : {}),
          ...(m.outputPricePerMtok !== null ? { outputPricePerMtok: String(m.outputPricePerMtok) } : {}),
          ...(m.cachedInputPricePerMtok !== null
            ? { cachedInputPricePerMtok: String(m.cachedInputPricePerMtok) }
            : {}),
        })
        .where(eq(models.id, existing.id));
      updated++;
    }
  }

  let retired = 0;
  const ids = listed.map((m) => m.modelId);
  if (opts.retire && ids.length > 0) {
    const r = await db
      .update(models)
      .set({ available: false })
      .where(
        and(
          eq(models.providerId, providerId),
          notInArray(models.modelId, ids),
          inArray(models.source, ['seed', 'fetched']),
        ),
      )
      .returning({ id: models.id });
    retired = r.length;
  }
  return { added, updated, retired, total: listed.length };
}
