import { and, desc, eq } from 'drizzle-orm';
import type { CredentialMode, ProviderKind } from '@agent/shared';
import { kindRequiresApiKey } from '@agent/providers';
import type { Db } from '../db/client.js';
import { models, providers, sharedKeyGrantModels, sharedKeyGrants, userKeys, users } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { KeyVault } from './vault.js';

export const KEY_PURPOSE = 'provider-key';

export interface ResolvedModel {
  id: string;
  modelId: string;
  displayName: string;
  providerId: string;
  providerSlug: string;
  providerKind: ProviderKind;
  baseUrl: string | null;
  available: boolean;
  supportsTools: boolean;
  pricing: { inputPricePerMtok: string | null; outputPricePerMtok: string | null; cachedInputPricePerMtok: string | null };
}

export interface ResolvedCredential {
  mode: Exclude<CredentialMode, 'subscription_cli'>;
  apiKey: string;
  baseUrl: string | undefined;
  userKeyId: string | null;
  sharedKeyGrantId: string | null;
}

export async function loadModel(db: Db, modelRef: string): Promise<ResolvedModel> {
  const [row] = await db
    .select({
      id: models.id,
      modelId: models.modelId,
      displayName: models.displayName,
      available: models.available,
      supportsTools: models.supportsTools,
      inputPricePerMtok: models.inputPricePerMtok,
      outputPricePerMtok: models.outputPricePerMtok,
      cachedInputPricePerMtok: models.cachedInputPricePerMtok,
      providerId: providers.id,
      providerSlug: providers.slug,
      providerKind: providers.kind,
      baseUrl: providers.baseUrl,
      providerEnabled: providers.enabled,
    })
    .from(models)
    .innerJoin(providers, eq(providers.id, models.providerId))
    .where(eq(models.id, modelRef))
    .limit(1);
  if (!row) throw new AppError('model_unavailable', 'The selected model does not exist.');
  if (!row.providerEnabled) throw new AppError('model_unavailable', `Provider ${row.providerSlug} is disabled.`);
  return {
    id: row.id,
    modelId: row.modelId,
    displayName: row.displayName,
    providerId: row.providerId,
    providerSlug: row.providerSlug,
    providerKind: row.providerKind,
    baseUrl: row.baseUrl,
    available: row.available,
    supportsTools: row.supportsTools,
    pricing: {
      inputPricePerMtok: row.inputPricePerMtok,
      outputPricePerMtok: row.outputPricePerMtok,
      cachedInputPricePerMtok: row.cachedInputPricePerMtok,
    },
  };
}

interface Actor {
  id: string;
  role: 'admin' | 'member';
}

/**
 * Decides which API key pays for a request.
 *
 * - `byok`: the actor's own active key for the provider.
 * - `shared`: members use an enabled admin grant whose allowlist covers the model;
 *   for the admin, "shared" keys are their own keys, so it is the same as byok.
 * - `null` (auto): BYOK if the actor has a key, otherwise a matching grant.
 *
 * Keyless OpenAI-compatible endpoints (local Ollama/LM Studio) are usable by the
 * admin without a key; members need a key or a grant like for any other provider.
 */
export async function resolveCredential(
  db: Db,
  vault: KeyVault,
  actor: Actor,
  model: ResolvedModel,
  requested: CredentialMode | null,
): Promise<ResolvedCredential> {
  if (requested === 'subscription_cli') {
    throw new AppError('validation_failed', 'Subscription CLI mode is not resolved through API keys.');
  }
  const baseUrl = model.baseUrl ?? undefined;

  if (requested === 'byok' || requested === null || actor.role === 'admin') {
    const own = await db.query.userKeys.findFirst({
      where: and(eq(userKeys.userId, actor.id), eq(userKeys.providerId, model.providerId), eq(userKeys.status, 'active')),
      orderBy: [desc(userKeys.updatedAt)],
    });
    if (own) {
      const apiKey = await vault.openForUser(actor.id, KEY_PURPOSE, { ciphertext: own.ciphertext, nonce: own.nonce });
      return { mode: 'byok', apiKey, baseUrl, userKeyId: own.id, sharedKeyGrantId: null };
    }
    if (actor.role === 'admin' && !kindRequiresApiKey(model.providerKind)) {
      return { mode: 'byok', apiKey: '', baseUrl, userKeyId: null, sharedKeyGrantId: null };
    }
    if (requested === 'byok' || actor.role === 'admin') {
      throw new AppError('credential_missing', `No active API key for ${model.providerSlug}. Add one in Settings → API keys.`);
    }
  }

  // Member, shared (explicit or auto fallback).
  const grants = await db
    .select({
      grantId: sharedKeyGrants.id,
      userKeyId: userKeys.id,
      ownerId: userKeys.userId,
      ciphertext: userKeys.ciphertext,
      nonce: userKeys.nonce,
    })
    .from(sharedKeyGrants)
    .innerJoin(userKeys, eq(userKeys.id, sharedKeyGrants.userKeyId))
    .innerJoin(users, eq(users.id, userKeys.userId))
    .where(
      and(
        eq(sharedKeyGrants.memberUserId, actor.id),
        eq(sharedKeyGrants.enabled, true),
        eq(userKeys.providerId, model.providerId),
        eq(userKeys.status, 'active'),
        eq(users.role, 'admin'),
      ),
    );
  for (const g of grants) {
    const allow = await db
      .select({ modelId: sharedKeyGrantModels.modelId })
      .from(sharedKeyGrantModels)
      .where(eq(sharedKeyGrantModels.grantId, g.grantId));
    if (allow.length > 0 && !allow.some((a) => a.modelId === model.id)) continue;
    const apiKey = await vault.openForUser(g.ownerId, KEY_PURPOSE, { ciphertext: g.ciphertext, nonce: g.nonce });
    return { mode: 'shared', apiKey, baseUrl, userKeyId: g.userKeyId, sharedKeyGrantId: g.grantId };
  }
  if (grants.length > 0) {
    throw new AppError('forbidden', `Model ${model.displayName} is not in your allowlist for the shared ${model.providerSlug} key.`);
  }
  throw new AppError(
    'credential_missing',
    requested === 'shared'
      ? `You have no shared ${model.providerSlug} key. Ask the admin for access.`
      : `No API key available for ${model.providerSlug}. Add your own key in Settings or ask the admin for shared access.`,
  );
}
