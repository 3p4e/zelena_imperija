import {
  boolean,
  index,
  inet,
  integer,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { NETWORK_MODES, USER_ROLES, USER_STATUSES } from '@agent/shared';
import { createdAt, id, updatedAt } from './common.js';

export const userRoleEnum = pgEnum('user_role', USER_ROLES);
export const userStatusEnum = pgEnum('user_status', USER_STATUSES);
export const networkModeEnum = pgEnum('network_mode', NETWORK_MODES);

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    displayName: text('display_name').notNull(),
    role: userRoleEnum('role').notNull().default('member'),
    status: userStatusEnum('status').notNull().default('active'),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sessions_token_hash_idx').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const invites = pgTable(
  'invites',
  {
    id: id(),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull(),
    role: userRoleEnum('role').notNull().default('member'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('invites_token_hash_idx').on(t.tokenHash)],
);

export const passwordResets = pgTable(
  'password_resets',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('password_resets_token_hash_idx').on(t.tokenHash)],
);

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: id(),
    subject: text('subject').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
    success: boolean('success').notNull(),
  },
  (t) => [index('login_attempts_subject_idx').on(t.subject, t.attemptedAt)],
);

export const memberLimits = pgTable('member_limits', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  sandboxCpu: real('sandbox_cpu').notNull(),
  sandboxMemMb: integer('sandbox_mem_mb').notNull(),
  sandboxDiskMb: integer('sandbox_disk_mb').notNull(),
  maxContainers: integer('max_containers').notNull(),
  networkMode: networkModeEnum('network_mode').notNull().default('egress'),
  updatedAt: updatedAt(),
});

export const memberToolRestrictions = pgTable(
  'member_tool_restrictions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
    allowed: boolean('allowed').notNull(),
  },
  (t) => [uniqueIndex('member_tool_restrictions_pk').on(t.userId, t.toolName)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    ip: inet('ip'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_actor_idx').on(t.actorUserId, t.at)],
);
