import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  CONVERSATION_STATUSES,
  MESSAGE_ROLES,
  MESSAGE_STATUSES,
  PART_KINDS,
  PROJECT_STATUSES,
  SHARE_PERMISSIONS,
} from '@agent/shared';
import { agentDefinitions } from './agents.js';
import { createdAt, id, updatedAt } from './common.js';
import { cliKindEnum, credentialModeEnum, models } from './providers.js';
import { users } from './users.js';

export const projectStatusEnum = pgEnum('project_status', PROJECT_STATUSES);
export const sharePermissionEnum = pgEnum('share_permission', SHARE_PERMISSIONS);
export const conversationStatusEnum = pgEnum('conversation_status', CONVERSATION_STATUSES);
export const messageRoleEnum = pgEnum('message_role', MESSAGE_ROLES);
export const messageStatusEnum = pgEnum('message_status', MESSAGE_STATUSES);
export const partKindEnum = pgEnum('part_kind', PART_KINDS);

export const projects = pgTable(
  'projects',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    defaultModelId: uuid('default_model_id').references(() => models.id, { onDelete: 'set null' }),
    defaultCredentialMode: credentialModeEnum('default_credential_mode'),
    defaultCliKind: cliKindEnum('default_cli_kind'),
    sandboxImage: text('sandbox_image').notNull(),
    status: projectStatusEnum('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('projects_owner_idx').on(t.ownerUserId)],
);

export const projectShares = pgTable(
  'project_shares',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permission: sharePermissionEnum('permission').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index('project_shares_user_idx').on(t.userId)],
);

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    agentDefinitionId: uuid('agent_definition_id')
      .notNull()
      .references(() => agentDefinitions.id),
    modelId: uuid('model_id').references(() => models.id, { onDelete: 'set null' }),
    credentialMode: credentialModeEnum('credential_mode'),
    cliKind: cliKindEnum('cli_kind'),
    /** Session/thread id reported by a subscription CLI, used to resume context across turns. */
    cliSessionId: text('cli_session_id'),
    status: conversationStatusEnum('status').notNull().default('idle'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('conversations_project_idx').on(t.projectId)],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: messageRoleEnum('role').notNull(),
    seq: integer('seq').notNull(),
    status: messageStatusEnum('status').notNull().default('complete'),
    modelId: uuid('model_id').references(() => models.id, { onDelete: 'set null' }),
    credentialMode: credentialModeEnum('credential_mode'),
    cliKind: cliKindEnum('cli_kind'),
    parentMessageId: uuid('parent_message_id'),
    /** Hidden from the transcript after regenerate; kept for history. */
    superseded: boolean('superseded').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('messages_conversation_seq_idx').on(t.conversationId, t.seq)],
);

export const messageParts = pgTable(
  'message_parts',
  {
    id: id(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    kind: partKindEnum('kind').notNull(),
    text: text('text'),
    toolName: text('tool_name'),
    toolCallId: text('tool_call_id'),
    /** Tool-call arguments, validated against the tool's JSON Schema before storage. */
    arguments: jsonb('arguments'),
    resultText: text('result_text'),
    isError: boolean('is_error'),
  },
  (t) => [uniqueIndex('message_parts_message_seq_idx').on(t.messageId, t.seq)],
);
