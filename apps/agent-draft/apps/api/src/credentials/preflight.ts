import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { globalSettings, sharedKeyGrants } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import { spentByUserSince, spentOnGrantSince, startOfUtcDay, startOfUtcMonth } from '../metering/usage.js';
import type { ResolvedCredential } from './resolver.js';

export interface PreflightInput {
  actor: { id: string; role: 'admin' | 'member' };
  credential: Pick<ResolvedCredential, 'mode' | 'sharedKeyGrantId'>;
  /** Registry prices of the model; shared-key use requires both so quotas can be enforced. */
  pricing: { inputPricePerMtok: string | null; outputPricePerMtok: string | null };
  /** Cost already spent by the current agent run (for the admin per-task cap). */
  runCostUsd: number;
}

/**
 * Server-side gate that runs before every provider request.
 *
 * - Members on admin-shared keys: daily and monthly spend quotas per grant.
 *   The grant row is locked for the check so concurrent requests serialise.
 * - Admin: optional safety cap (per task and per day). It is a circuit breaker
 *   the admin can raise or disable in settings, not a quota.
 * - Members on their own keys: never blocked here.
 */
export async function preflight(db: Db, input: PreflightInput): Promise<void> {
  if (input.actor.role === 'admin') {
    const s = await db.query.globalSettings.findFirst({ where: eq(globalSettings.id, 1) });
    if (!s?.adminSafetyCapEnabled) return;
    const perTask = s.adminCapPerTaskUsd === null ? null : Number(s.adminCapPerTaskUsd);
    const perDay = s.adminCapPerDayUsd === null ? null : Number(s.adminCapPerDayUsd);
    if (perTask !== null && input.runCostUsd >= perTask) {
      throw new AppError(
        'safety_cap_reached',
        `This task reached your per-task safety cap of $${perTask.toFixed(2)}. Raise or disable it in Admin → Settings, then retry.`,
        { scope: 'task', capUsd: perTask, spentUsd: input.runCostUsd },
      );
    }
    if (perDay !== null) {
      const today = await spentByUserSince(db, input.actor.id, startOfUtcDay());
      if (today >= perDay) {
        throw new AppError(
          'safety_cap_reached',
          `You reached your daily safety cap of $${perDay.toFixed(2)}. Raise or disable it in Admin → Settings.`,
          { scope: 'day', capUsd: perDay, spentUsd: today },
        );
      }
    }
    return;
  }

  if (input.credential.mode !== 'shared' || !input.credential.sharedKeyGrantId) return;
  if (input.pricing.inputPricePerMtok === null || input.pricing.outputPricePerMtok === null) {
    // Unknown cost would make the quota unenforceable, so shared use of unpriced models is refused.
    throw new AppError(
      'forbidden',
      'This model has no price in the registry, so it cannot be used on a shared key. Ask the admin to set its price, or use your own key.',
    );
  }
  const grantId = input.credential.sharedKeyGrantId;
  await db.transaction(async (tx) => {
    const [grant] = await tx
      .select()
      .from(sharedKeyGrants)
      .where(eq(sharedKeyGrants.id, grantId))
      .for('update');
    if (!grant?.enabled) throw new AppError('forbidden', 'Your access to this shared key was revoked.');
    const daily = Number(grant.dailyLimitUsd);
    const monthly = Number(grant.monthlyLimitUsd);
    const spentToday = await spentOnGrantSince(tx, grantId, startOfUtcDay());
    if (spentToday >= daily) {
      throw new AppError(
        'quota_exceeded',
        `Daily quota on the shared key reached ($${daily.toFixed(2)}). It resets at 00:00 UTC. Your own API keys still work.`,
        {
          scope: 'day',
          limitUsd: daily,
          spentUsd: spentToday,
        },
      );
    }
    const spentMonth = await spentOnGrantSince(tx, grantId, startOfUtcMonth());
    if (spentMonth >= monthly) {
      throw new AppError(
        'quota_exceeded',
        `Monthly quota on the shared key reached ($${monthly.toFixed(2)}). Your own API keys still work.`,
        {
          scope: 'month',
          limitUsd: monthly,
          spentUsd: spentMonth,
        },
      );
    }
  });
}
