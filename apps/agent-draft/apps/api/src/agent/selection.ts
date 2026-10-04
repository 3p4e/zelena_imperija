import { eq } from 'drizzle-orm';
import type { CliKind, CredentialMode } from '@agent/shared';
import type { Db } from '../db/client.js';
import { globalSettings, userDefaults } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';

export interface SelectionInput {
  modelId?: string | null | undefined;
  credentialMode?: CredentialMode | null | undefined;
  cliKind?: CliKind | null | undefined;
}

export type Selection =
  | { kind: 'api'; modelRef: string; credentialMode: Exclude<CredentialMode, 'subscription_cli'> | null }
  | { kind: 'cli'; cliKind: CliKind };

/**
 * Effective model/credential for a request, in priority order:
 * message → conversation → project → user default → global default.
 */
export async function resolveSelection(
  db: Db,
  userId: string,
  layers: { message: SelectionInput; conversation: SelectionInput; project: SelectionInput },
): Promise<Selection> {
  const defaults = await db.query.userDefaults.findFirst({ where: eq(userDefaults.userId, userId) });
  const settings = await db.query.globalSettings.findFirst({ where: eq(globalSettings.id, 1) });
  const ordered: SelectionInput[] = [
    layers.message,
    layers.conversation,
    layers.project,
    { modelId: defaults?.defaultModelId ?? null, credentialMode: defaults?.defaultCredentialMode ?? null },
    { modelId: settings?.defaultModelId ?? null },
  ];

  // The first layer that names a credential mode decides whether this is a CLI run.
  const modeLayer = ordered.find((l) => l.credentialMode);
  if (modeLayer?.credentialMode === 'subscription_cli') {
    const cliKind = ordered.find((l) => l.cliKind)?.cliKind;
    if (!cliKind) throw new AppError('validation_failed', 'Choose which subscription CLI to use.');
    return { kind: 'cli', cliKind };
  }
  const modelRef = ordered.find((l) => l.modelId)?.modelId;
  if (!modelRef)
    throw new AppError('model_unavailable', 'No model selected and no default model is configured.');
  return {
    kind: 'api',
    modelRef,
    credentialMode: (modeLayer?.credentialMode as 'byok' | 'shared' | undefined) ?? null,
  };
}
