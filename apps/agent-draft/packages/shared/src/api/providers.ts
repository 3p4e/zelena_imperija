import { z } from 'zod';
import { CREDENTIAL_MODES, KEY_STATUSES, MODEL_SOURCES, PROVIDER_KINDS } from '../enums.js';

export const providerSchema = z.object({
  id: z.uuid(),
  kind: z.enum(PROVIDER_KINDS),
  slug: z.string(),
  displayName: z.string(),
  baseUrl: z.string().nullable(),
  enabled: z.boolean(),
});
export type Provider = z.infer<typeof providerSchema>;

export const createProviderSchema = z.object({
  kind: z.enum(PROVIDER_KINDS),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/),
  displayName: z.string().trim().min(1).max(80),
  baseUrl: z.url().nullable().optional(),
  enabled: z.boolean().default(true),
});
export const updateProviderSchema = createProviderSchema.omit({ kind: true, slug: true }).partial();

export const modelSchema = z.object({
  id: z.uuid(),
  providerId: z.uuid(),
  providerSlug: z.string(),
  providerKind: z.enum(PROVIDER_KINDS),
  modelId: z.string(),
  displayName: z.string(),
  contextWindow: z.number().int(),
  maxOutput: z.number().int().nullable(),
  inputPricePerMtok: z.number().nullable(),
  outputPricePerMtok: z.number().nullable(),
  cachedInputPricePerMtok: z.number().nullable(),
  supportsVision: z.boolean(),
  supportsTools: z.boolean(),
  supportsReasoning: z.boolean(),
  supportsStructuredOutput: z.boolean(),
  available: z.boolean(),
  source: z.enum(MODEL_SOURCES),
  lastFetchedAt: z.iso.datetime().nullable(),
});
export type Model = z.infer<typeof modelSchema>;

export const upsertModelSchema = z.object({
  modelId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(120),
  contextWindow: z.number().int().min(1),
  maxOutput: z.number().int().min(1).nullable().optional(),
  inputPricePerMtok: z.number().min(0).nullable().optional(),
  outputPricePerMtok: z.number().min(0).nullable().optional(),
  cachedInputPricePerMtok: z.number().min(0).nullable().optional(),
  supportsVision: z.boolean().default(false),
  supportsTools: z.boolean().default(true),
  supportsReasoning: z.boolean().default(false),
  supportsStructuredOutput: z.boolean().default(true),
  available: z.boolean().default(true),
});
export type UpsertModel = z.infer<typeof upsertModelSchema>;

/** API keys are never returned; only metadata. */
export const userKeySchema = z.object({
  id: z.uuid(),
  providerId: z.uuid(),
  providerSlug: z.string(),
  label: z.string(),
  last4: z.string(),
  status: z.enum(KEY_STATUSES),
  lastValidatedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type UserKey = z.infer<typeof userKeySchema>;

export const createUserKeySchema = z.object({
  providerId: z.uuid(),
  label: z.string().trim().min(1).max(60).default('default'),
  apiKey: z.string().trim().min(8).max(4096),
});

export const keyTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  modelsSeen: z.number().int().nullable(),
});
export type KeyTestResult = z.infer<typeof keyTestResultSchema>;

export const sharedKeyGrantSchema = z.object({
  id: z.uuid(),
  userKeyId: z.uuid(),
  keyLabel: z.string(),
  providerSlug: z.string(),
  memberUserId: z.uuid(),
  memberEmail: z.string(),
  dailyLimitUsd: z.number(),
  monthlyLimitUsd: z.number(),
  enabled: z.boolean(),
  allowedModelIds: z.array(z.uuid()),
  spentTodayUsd: z.number(),
  spentMonthUsd: z.number(),
});
export type SharedKeyGrant = z.infer<typeof sharedKeyGrantSchema>;

export const createSharedKeyGrantSchema = z.object({
  userKeyId: z.uuid(),
  memberUserId: z.uuid(),
  dailyLimitUsd: z.number().min(0),
  monthlyLimitUsd: z.number().min(0),
  enabled: z.boolean().default(true),
  allowedModelIds: z.array(z.uuid()).default([]),
});
export const updateSharedKeyGrantSchema = createSharedKeyGrantSchema
  .omit({ userKeyId: true, memberUserId: true })
  .partial();

/** What a user can actually pick in the model dropdown. */
export const availableModelOptionSchema = z.object({
  model: modelSchema,
  credentialModes: z.array(z.enum(CREDENTIAL_MODES)),
});
export type AvailableModelOption = z.infer<typeof availableModelOptionSchema>;
