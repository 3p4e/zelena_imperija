import { boolean, integer, jsonb, pgEnum, pgTable, primaryKey, text, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import { MCP_TRANSPORTS, TOOL_PERMISSIONS, TOOL_SOURCES } from '@agent/shared';
import { createdAt, id, updatedAt } from './common.js';
import { bytea, models } from './providers.js';
import { users } from './users.js';

export const toolPermissionEnum = pgEnum('tool_permission', TOOL_PERMISSIONS);
export const toolSourceEnum = pgEnum('tool_source', TOOL_SOURCES);
export const mcpTransportEnum = pgEnum('mcp_transport', MCP_TRANSPORTS);

export const agentDefinitions = pgTable(
  'agent_definitions',
  {
    id: id(),
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    roleDescription: text('role_description').notNull().default(''),
    systemPrompt: text('system_prompt').notNull(),
    defaultModelId: uuid('default_model_id').references(() => models.id, { onDelete: 'set null' }),
    maxIterations: integer('max_iterations').notNull().default(40),
    enabled: boolean('enabled').notNull().default(true),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('agent_definitions_slug_idx').on(t.slug)],
);

export const agentDefinitionTools = pgTable(
  'agent_definition_tools',
  {
    agentDefinitionId: uuid('agent_definition_id')
      .notNull()
      .references(() => agentDefinitions.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentDefinitionId, t.toolName] })],
);

export const mcpServers = pgTable(
  'mcp_servers',
  {
    id: id(),
    /** null = global (admin-configured, visible to everyone the admin allows). */
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    transport: mcpTransportEnum('transport').notNull(),
    command: text('command'),
    args: text('args').array().notNull().default([]),
    url: text('url'),
    /** Encrypted JSON map of env vars; opaque vendor configuration. */
    envCiphertext: bytea('env_ciphertext'),
    envNonce: bytea('env_nonce'),
    enabled: boolean('enabled').notNull().default(true),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('mcp_servers_name_idx').on(t.name)],
);

export const toolCatalog = pgTable('tool_catalog', {
  name: text('name').primaryKey(),
  source: toolSourceEnum('source').notNull(),
  mcpServerId: uuid('mcp_server_id').references(() => mcpServers.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  /** JSON Schema for the tool input; inherently a schema document. */
  inputSchema: jsonb('input_schema').notNull(),
  permission: toolPermissionEnum('permission').notNull(),
  requiresApproval: boolean('requires_approval').notNull().default(false),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: updatedAt(),
});
