import { index, integer, numeric, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { USAGE_STATUSES } from '@agent/shared';
import { id } from './common.js';
import { conversations, messages, projects } from './projects.js';
import { credentialModeEnum, models, providers, sharedKeyGrants, userKeys } from './providers.js';
import { users } from './users.js';

export const usageStatusEnum = pgEnum('usage_status', USAGE_STATUSES);

export const usageRecords = pgTable(
  'usage_records',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    providerId: uuid('provider_id').references(() => providers.id, { onDelete: 'set null' }),
    providerSlug: text('provider_slug').notNull(),
    modelRef: uuid('model_ref').references(() => models.id, { onDelete: 'set null' }),
    modelId: text('model_id').notNull(),
    credentialSource: credentialModeEnum('credential_source').notNull(),
    userKeyId: uuid('user_key_id').references(() => userKeys.id, { onDelete: 'set null' }),
    sharedKeyGrantId: uuid('shared_key_grant_id').references(() => sharedKeyGrants.id, {
      onDelete: 'set null',
    }),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens'),
    estimatedCostUsd: numeric('estimated_cost_usd', { precision: 14, scale: 8 }),
    durationMs: integer('duration_ms').notNull().default(0),
    status: usageStatusEnum('status').notNull(),
    errorCode: text('error_code'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('usage_records_user_at_idx').on(t.userId, t.at),
    index('usage_records_project_at_idx').on(t.projectId, t.at),
    index('usage_records_grant_at_idx').on(t.sharedKeyGrantId, t.at),
  ],
);
