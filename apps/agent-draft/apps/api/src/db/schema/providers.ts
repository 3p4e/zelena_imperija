import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  CLI_KINDS,
  CLI_LOGIN_STATES,
  CREDENTIAL_MODES,
  KEY_STATUSES,
  MODEL_SOURCES,
  PROVIDER_KINDS,
} from '@agent/shared';
import { createdAt, id, updatedAt } from './common.js';
import { users } from './users.js';

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const providerKindEnum = pgEnum('provider_kind', PROVIDER_KINDS);
export const credentialModeEnum = pgEnum('credential_mode', CREDENTIAL_MODES);
export const keyStatusEnum = pgEnum('key_status', KEY_STATUSES);
export const modelSourceEnum = pgEnum('model_source', MODEL_SOURCES);
export const cliKindEnum = pgEnum('cli_kind', CLI_KINDS);
export const cliLoginStateEnum = pgEnum('cli_login_state', CLI_LOGIN_STATES);

export const providers = pgTable(
  'providers',
  {
    id: id(),
    kind: providerKindEnum('kind').notNull(),
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    baseUrl: text('base_url'),
    // Hosted providers need an API key; a local server (e.g. Ollama) does not.
    requiresKey: boolean('requires_key').notNull().default(true),
    category: text('category').notNull().default('cloud'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('providers_slug_idx').on(t.slug)],
);

export const models = pgTable(
  'models',
  {
    id: id(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    modelId: text('model_id').notNull(),
    displayName: text('display_name').notNull(),
    contextWindow: integer('context_window').notNull(),
    maxOutput: integer('max_output'),
    inputPricePerMtok: numeric('input_price_per_mtok', { precision: 12, scale: 6 }),
    outputPricePerMtok: numeric('output_price_per_mtok', { precision: 12, scale: 6 }),
    cachedInputPricePerMtok: numeric('cached_input_price_per_mtok', { precision: 12, scale: 6 }),
    supportsVision: boolean('supports_vision').notNull().default(false),
    supportsTools: boolean('supports_tools').notNull().default(true),
    supportsReasoning: boolean('supports_reasoning').notNull().default(false),
    supportsStructuredOutput: boolean('supports_structured_output').notNull().default(true),
    available: boolean('available').notNull().default(true),
    // Admin curation for the chat picker: hidden drops a model from the list, favorite pins it on top.
    hidden: boolean('hidden').notNull().default(false),
    favorite: boolean('favorite').notNull().default(false),
    source: modelSourceEnum('source').notNull().default('seed'),
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('models_provider_model_idx').on(t.providerId, t.modelId)],
);

export const globalSettings = pgTable(
  'global_settings',
  {
    /** Always 1: single-row table enforced by a check constraint. */
    id: integer('id').primaryKey(),
    defaultModelId: uuid('default_model_id').references(() => models.id, { onDelete: 'set null' }),
    adminSafetyCapEnabled: boolean('admin_safety_cap_enabled').notNull().default(true),
    adminCapPerTaskUsd: numeric('admin_cap_per_task_usd', { precision: 12, scale: 4 }),
    adminCapPerDayUsd: numeric('admin_cap_per_day_usd', { precision: 12, scale: 4 }),
    adminSandboxCpu: real('admin_sandbox_cpu').notNull().default(4),
    adminSandboxMemMb: integer('admin_sandbox_mem_mb').notNull().default(8192),
    adminSandboxDiskMb: integer('admin_sandbox_disk_mb').notNull().default(20480),
    adminMaxContainers: integer('admin_max_containers').notNull().default(10),
    memberSandboxCpu: real('member_sandbox_cpu').notNull().default(1),
    memberSandboxMemMb: integer('member_sandbox_mem_mb').notNull().default(2048),
    memberSandboxDiskMb: integer('member_sandbox_disk_mb').notNull().default(4096),
    memberMaxContainers: integer('member_max_containers').notNull().default(2),
    containerIdleMinutes: integer('container_idle_minutes').notNull().default(30),
    commandTimeoutS: integer('command_timeout_s').notNull().default(300),
    agentMaxIterations: integer('agent_max_iterations').notNull().default(40),
    updatedAt: updatedAt(),
  },
  (t) => [check('global_settings_singleton', sql`${t.id} = 1`)],
);

export const userKeys = pgTable(
  'user_keys',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    ciphertext: bytea('ciphertext').notNull(),
    nonce: bytea('nonce').notNull(),
    keyVersion: integer('key_version').notNull(),
    last4: text('last4').notNull(),
    status: keyStatusEnum('status').notNull().default('active'),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('user_keys_user_provider_label_idx').on(t.userId, t.providerId, t.label)],
);

export const userDeks = pgTable('user_deks', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  wrappedDek: bytea('wrapped_dek').notNull(),
  nonce: bytea('nonce').notNull(),
  masterKeyVersion: integer('master_key_version').notNull(),
  createdAt: createdAt(),
});

export const sharedKeyGrants = pgTable(
  'shared_key_grants',
  {
    id: id(),
    userKeyId: uuid('user_key_id')
      .notNull()
      .references(() => userKeys.id, { onDelete: 'cascade' }),
    memberUserId: uuid('member_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dailyLimitUsd: numeric('daily_limit_usd', { precision: 12, scale: 4 }).notNull(),
    monthlyLimitUsd: numeric('monthly_limit_usd', { precision: 12, scale: 4 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('shared_key_grants_key_member_idx').on(t.userKeyId, t.memberUserId),
    index('shared_key_grants_member_idx').on(t.memberUserId),
  ],
);

export const sharedKeyGrantModels = pgTable(
  'shared_key_grant_models',
  {
    grantId: uuid('grant_id')
      .notNull()
      .references(() => sharedKeyGrants.id, { onDelete: 'cascade' }),
    modelId: uuid('model_id')
      .notNull()
      .references(() => models.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.grantId, t.modelId] })],
);

export const userDefaults = pgTable('user_defaults', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  defaultModelId: uuid('default_model_id').references(() => models.id, { onDelete: 'set null' }),
  defaultCredentialMode: credentialModeEnum('default_credential_mode'),
  updatedAt: updatedAt(),
});

export const cliProviders = pgTable(
  'cli_providers',
  {
    id: id(),
    kind: cliKindEnum('kind').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    binaryVersion: text('binary_version'),
    loginState: cliLoginStateEnum('login_state').notNull().default('unknown'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastError: text('last_error'),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('cli_providers_kind_idx').on(t.kind)],
);
