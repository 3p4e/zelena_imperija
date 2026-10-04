import { z } from 'zod';
import { MCP_TRANSPORTS, TOOL_PERMISSIONS, TOOL_SOURCES } from '../enums.js';

export const agentDefinitionSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  displayName: z.string(),
  roleDescription: z.string(),
  systemPrompt: z.string(),
  defaultModelId: z.uuid().nullable(),
  maxIterations: z.number().int(),
  enabled: z.boolean(),
  isPrimary: z.boolean(),
  toolNames: z.array(z.string()),
});
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;

export const upsertAgentDefinitionSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/),
  displayName: z.string().trim().min(1).max(80),
  roleDescription: z.string().trim().max(500),
  systemPrompt: z.string().min(1).max(50_000),
  defaultModelId: z.uuid().nullable().optional(),
  maxIterations: z.number().int().min(1).max(500).default(40),
  enabled: z.boolean().default(true),
  isPrimary: z.boolean().default(false),
  toolNames: z.array(z.string().min(1).max(120)).max(200),
});

export const toolCatalogEntrySchema = z.object({
  name: z.string(),
  source: z.enum(TOOL_SOURCES),
  mcpServerId: z.uuid().nullable(),
  description: z.string(),
  permission: z.enum(TOOL_PERMISSIONS),
  requiresApproval: z.boolean(),
  enabled: z.boolean(),
  /** For members: whether the admin allows this tool for them. */
  allowedForMe: z.boolean(),
});
export type ToolCatalogEntry = z.infer<typeof toolCatalogEntrySchema>;

export const mcpServerSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  transport: z.enum(MCP_TRANSPORTS),
  command: z.string().nullable(),
  args: z.array(z.string()),
  url: z.string().nullable(),
  enabled: z.boolean(),
  hasEnv: z.boolean(),
  lastError: z.string().nullable(),
  toolCount: z.number().int(),
});
export type McpServer = z.infer<typeof mcpServerSchema>;

export const upsertMcpServerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_-]+$/i),
  transport: z.enum(MCP_TRANSPORTS),
  command: z.string().trim().max(500).nullable().optional(),
  args: z.array(z.string().max(500)).max(50).default([]),
  url: z.url().nullable().optional(),
  env: z.record(z.string().max(100), z.string().max(4000)).optional(),
  enabled: z.boolean().default(true),
});
