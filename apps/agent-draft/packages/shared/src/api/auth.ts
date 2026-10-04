import { z } from 'zod';
import { USER_ROLES, USER_STATUSES } from '../enums.js';

export const emailSchema = z.email().trim().toLowerCase().max(254);
export const passwordSchema = z.string().min(10).max(256);

export const loginRequestSchema = z.object({ email: emailSchema, password: z.string().min(1).max(256) });
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const userPublicSchema = z.object({
  id: z.uuid(),
  email: emailSchema,
  displayName: z.string(),
  role: z.enum(USER_ROLES),
  status: z.enum(USER_STATUSES),
  createdAt: z.iso.datetime(),
});
export type UserPublic = z.infer<typeof userPublicSchema>;

export const meResponseSchema = z.object({
  user: userPublicSchema,
  capabilities: z.object({
    subscriptionCli: z.boolean(),
    admin: z.boolean(),
  }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const acceptInviteRequestSchema = z.object({
  token: z.string().min(16).max(256),
  displayName: z.string().trim().min(1).max(80),
  password: passwordSchema,
});
export type AcceptInviteRequest = z.infer<typeof acceptInviteRequestSchema>;

export const requestPasswordResetSchema = z.object({ email: emailSchema });
export const completePasswordResetSchema = z.object({
  token: z.string().min(16).max(256),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});
