import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { createUserKeySchema, type KeyTestResult, type UserKey } from '@agent/shared';
import { ProviderError } from '@agent/providers';
import type { AppDeps } from '../../deps.js';
import { models, providers, userKeys } from '../../db/schema/index.js';
import { currentUser } from '../../auth/plugin.js';
import { KEY_PURPOSE } from '../../credentials/resolver.js';
import { last4 } from '../../credentials/vault.js';
import { AppError, notFound } from '../../lib/errors.js';
import { parseBody, requireUuid } from '../../lib/validate.js';
import { iso } from '../dto.js';
import { syncProviderModels } from '../providers/model-sync.js';

/**
 * BYOK management. Keys are write-only: after saving, only metadata (label,
 * last four characters, status) is ever returned. Plaintext exists in memory
 * only while a provider request or a connection test is in flight.
 */
export function registerKeyRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  const list = async (userId: string): Promise<UserKey[]> => {
    const rows = await db
      .select({ k: userKeys, slug: providers.slug })
      .from(userKeys)
      .innerJoin(providers, eq(providers.id, userKeys.providerId))
      .where(eq(userKeys.userId, userId))
      .orderBy(desc(userKeys.createdAt));
    return rows.map(({ k, slug }) => ({
      id: k.id,
      providerId: k.providerId,
      providerSlug: slug,
      label: k.label,
      last4: k.last4,
      status: k.status,
      lastValidatedAt: iso(k.lastValidatedAt),
      createdAt: k.createdAt.toISOString(),
    }));
  };

  app.get('/keys', async (req) => list(currentUser(req).id));

  app.post('/keys', async (req, reply) => {
    const user = currentUser(req);
    const body = parseBody(createUserKeySchema, req.body);
    const provider = await db.query.providers.findFirst({
      where: and(eq(providers.id, body.providerId), eq(providers.enabled, true)),
    });
    if (!provider) throw new AppError('validation_failed', 'Unknown or disabled provider.');
    const sealed = await deps.vault.sealForUser(user.id, KEY_PURPOSE, body.apiKey);
    const existing = await db.query.userKeys.findFirst({
      where: and(
        eq(userKeys.userId, user.id),
        eq(userKeys.providerId, provider.id),
        eq(userKeys.label, body.label),
      ),
    });
    const values = {
      ciphertext: sealed.ciphertext,
      nonce: sealed.nonce,
      keyVersion: sealed.keyVersion,
      last4: last4(body.apiKey),
      status: 'active' as const,
      lastValidatedAt: null,
    };
    let id: string;
    if (existing) {
      await db.update(userKeys).set(values).where(eq(userKeys.id, existing.id));
      id = existing.id;
    } else {
      const [row] = await db
        .insert(userKeys)
        .values({ userId: user.id, providerId: provider.id, label: body.label, ...values })
        .returning({ id: userKeys.id });
      if (!row) throw new AppError('internal', 'Could not store the key.');
      id = row.id;
    }
    await deps.audit(user.id, 'key.save', 'user_key', id, req.ip);
    const saved = (await list(user.id)).find((k) => k.id === id);
    return reply.code(existing ? 200 : 201).send(saved);
  });

  app.post('/keys/:id/test', async (req): Promise<KeyTestResult> => {
    const user = currentUser(req);
    const id = requireUuid((req.params as { id: string }).id);
    const key = await db.query.userKeys.findFirst({
      where: and(eq(userKeys.id, id), eq(userKeys.userId, user.id)),
    });
    if (!key) throw notFound('Key');
    if (key.status === 'revoked') throw new AppError('validation_failed', 'This key was revoked.');
    const provider = await db.query.providers.findFirst({ where: eq(providers.id, key.providerId) });
    if (!provider) throw notFound('Provider');
    const apiKey = await deps.vault.openForUser(user.id, KEY_PURPOSE, {
      ciphertext: key.ciphertext,
      nonce: key.nonce,
    });
    const instance = deps.providerFactory(provider.kind, {
      apiKey,
      baseUrl: provider.baseUrl ?? undefined,
      timeoutMs: 20_000,
    });

    // Prefer listing the provider's live models: it both verifies the key and gives us the
    // real catalogue to put in the picker. Not every provider exposes a /models endpoint
    // (e.g. Perplexity), so if listing fails for a reason other than a rejected key, fall
    // back to a one-token chat against a known model to confirm the key still works.
    const verify = async (): Promise<{ ok: boolean; message: string; imported: number }> => {
      try {
        const listed = await instance.listModels();
        const synced = await syncProviderModels(db, provider.id, listed, { retire: false });
        return {
          ok: true,
          message: `Credential accepted; ${listed.length} models available.`,
          imported: synced.total,
        };
      } catch (listErr) {
        if (listErr instanceof ProviderError && listErr.code === 'auth') {
          return { ok: false, message: listErr.message, imported: 0 };
        }
        // The listing endpoint is missing or unsupported; verify the key with a tiny call.
        const probe = await db.query.models.findFirst({
          where: and(eq(models.providerId, provider.id), eq(models.available, true)),
        });
        if (!probe) {
          return {
            ok: false,
            message: 'Could not list models and no model is configured to test the key against.',
            imported: 0,
          };
        }
        try {
          await instance.chat({
            model: probe.modelId,
            messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
            maxOutputTokens: 1,
          });
          return {
            ok: true,
            message: 'Credential accepted (this provider does not publish a model list).',
            imported: 0,
          };
        } catch (chatErr) {
          return {
            ok: false,
            message: chatErr instanceof Error ? chatErr.message : 'The key could not be verified.',
            imported: 0,
          };
        }
      }
    };

    const { ok, message, imported } = await verify();
    await db
      .update(userKeys)
      .set({ status: ok ? 'active' : 'invalid', lastValidatedAt: new Date() })
      .where(eq(userKeys.id, key.id));
    return { ok, message, modelsSeen: ok ? imported : null };
  });

  /** Revoke: the ciphertext is destroyed; the row stays so usage history keeps its reference. */
  app.delete('/keys/:id', async (req) => {
    const user = currentUser(req);
    const id = requireUuid((req.params as { id: string }).id);
    const key = await db.query.userKeys.findFirst({
      where: and(eq(userKeys.id, id), eq(userKeys.userId, user.id)),
    });
    if (!key) throw notFound('Key');
    await db
      .update(userKeys)
      .set({
        status: 'revoked',
        ciphertext: Buffer.alloc(0),
        nonce: Buffer.alloc(0),
        label: `${key.label} (revoked ${new Date().toISOString().slice(0, 19)})`,
      })
      .where(eq(userKeys.id, key.id));
    await deps.audit(user.id, 'key.revoke', 'user_key', key.id, req.ip);
    return { ok: true };
  });
}
