import { z } from 'zod';
import { CREDENTIAL_MODES, USAGE_STATUSES } from '../enums.js';

export const usageRecordSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  projectId: z.uuid().nullable(),
  conversationId: z.uuid().nullable(),
  providerSlug: z.string(),
  modelId: z.string(),
  credentialSource: z.enum(CREDENTIAL_MODES),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cachedInputTokens: z.number().int(),
  reasoningTokens: z.number().int().nullable(),
  estimatedCostUsd: z.number().nullable(),
  durationMs: z.number().int(),
  status: z.enum(USAGE_STATUSES),
  errorCode: z.string().nullable(),
  at: z.iso.datetime(),
});
export type UsageRecord = z.infer<typeof usageRecordSchema>;

export const usageSummarySchema = z.object({
  requests: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  estimatedCostUsd: z.number(),
  byModel: z.array(
    z.object({
      providerSlug: z.string(),
      modelId: z.string(),
      requests: z.number().int(),
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
      estimatedCostUsd: z.number(),
    }),
  ),
  byDay: z.array(z.object({ day: z.string(), requests: z.number().int(), estimatedCostUsd: z.number() })),
});
export type UsageSummary = z.infer<typeof usageSummarySchema>;

export const usageQuerySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  projectId: z.uuid().optional(),
  userId: z.uuid().optional(),
});
