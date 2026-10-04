import { z } from 'zod';
import { CLI_KINDS, CLI_LOGIN_STATES, NETWORK_MODES, USER_ROLES } from '../enums.js';
import { emailSchema, passwordSchema, userPublicSchema } from './auth.js';

export const createUserRequestSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().min(1).max(80),
  role: z.enum(USER_ROLES).default('member'),
  password: passwordSchema.optional(),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const createInviteRequestSchema = z.object({
  email: emailSchema,
  role: z.enum(USER_ROLES).default('member'),
  expiresInHours: z.number().int().min(1).max(24 * 30).default(72),
});
export const inviteSchema = z.object({
  id: z.uuid(),
  email: emailSchema,
  role: z.enum(USER_ROLES),
  expiresAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  /** Only present in the create response; never stored in plaintext. */
  acceptUrl: z.string().optional(),
});
export type Invite = z.infer<typeof inviteSchema>;

export const updateUserStatusSchema = z.object({ status: z.enum(['active', 'suspended']) });

export const memberLimitsSchema = z.object({
  sandboxCpu: z.number().min(0.1).max(64),
  sandboxMemMb: z.number().int().min(128).max(262144),
  sandboxDiskMb: z.number().int().min(128).max(1048576),
  maxContainers: z.number().int().min(0).max(100),
  networkMode: z.enum(NETWORK_MODES),
});
export type MemberLimits = z.infer<typeof memberLimitsSchema>;

export const toolRestrictionSchema = z.object({ toolName: z.string().min(1).max(120), allowed: z.boolean() });
export const setToolRestrictionsSchema = z.object({ restrictions: z.array(toolRestrictionSchema).max(500) });

export const globalSettingsSchema = z.object({
  defaultModelId: z.uuid().nullable(),
  adminSafetyCapEnabled: z.boolean(),
  adminCapPerTaskUsd: z.number().min(0).nullable(),
  adminCapPerDayUsd: z.number().min(0).nullable(),
  adminSandboxCpu: z.number().min(0.1).max(64),
  adminSandboxMemMb: z.number().int().min(128),
  adminSandboxDiskMb: z.number().int().min(128),
  adminMaxContainers: z.number().int().min(0),
  memberSandboxCpu: z.number().min(0.1).max(64),
  memberSandboxMemMb: z.number().int().min(128),
  memberSandboxDiskMb: z.number().int().min(128),
  memberMaxContainers: z.number().int().min(0),
  containerIdleMinutes: z.number().int().min(1),
  commandTimeoutS: z.number().int().min(1).max(3600),
  agentMaxIterations: z.number().int().min(1).max(500),
});
export type GlobalSettings = z.infer<typeof globalSettingsSchema>;
export const updateGlobalSettingsSchema = globalSettingsSchema.partial();

export const adminUserRowSchema = userPublicSchema.extend({
  suspendedAt: z.iso.datetime().nullable(),
  lastSeenAt: z.iso.datetime().nullable(),
  limits: memberLimitsSchema.nullable(),
});
export type AdminUserRow = z.infer<typeof adminUserRowSchema>;

export const cliProviderStatusSchema = z.object({
  kind: z.enum(CLI_KINDS),
  enabled: z.boolean(),
  binaryVersion: z.string().nullable(),
  loginState: z.enum(CLI_LOGIN_STATES),
  lastCheckedAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
});
export type CliProviderStatus = z.infer<typeof cliProviderStatusSchema>;
