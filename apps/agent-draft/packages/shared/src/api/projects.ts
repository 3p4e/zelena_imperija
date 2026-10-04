import { z } from 'zod';
import {
  CLI_KINDS,
  CONVERSATION_STATUSES,
  CREDENTIAL_MODES,
  MESSAGE_ROLES,
  MESSAGE_STATUSES,
  PART_KINDS,
  PROJECT_STATUSES,
  SANDBOX_STATUSES,
  SHARE_PERMISSIONS,
} from '../enums.js';

export const projectSchema = z.object({
  id: z.uuid(),
  ownerUserId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  defaultModelId: z.uuid().nullable(),
  defaultCredentialMode: z.enum(CREDENTIAL_MODES).nullable(),
  defaultCliKind: z.enum(CLI_KINDS).nullable(),
  sandboxImage: z.string(),
  status: z.enum(PROJECT_STATUSES),
  myPermission: z.enum(['owner', ...SHARE_PERMISSIONS]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).nullable().optional(),
  defaultModelId: z.uuid().nullable().optional(),
  defaultCredentialMode: z.enum(CREDENTIAL_MODES).nullable().optional(),
  defaultCliKind: z.enum(CLI_KINDS).nullable().optional(),
});
export const updateProjectSchema = createProjectSchema
  .extend({ status: z.enum(PROJECT_STATUSES), sandboxImage: z.string().trim().min(1).max(200) })
  .partial();

export const projectShareSchema = z.object({
  userId: z.uuid(),
  email: z.string(),
  permission: z.enum(SHARE_PERMISSIONS),
});
export const upsertProjectShareSchema = z.object({
  email: z.email().trim().toLowerCase(),
  permission: z.enum(SHARE_PERMISSIONS),
});

export const conversationSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  title: z.string(),
  agentDefinitionId: z.uuid(),
  modelId: z.uuid().nullable(),
  credentialMode: z.enum(CREDENTIAL_MODES).nullable(),
  cliKind: z.enum(CLI_KINDS).nullable(),
  status: z.enum(CONVERSATION_STATUSES),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  agentDefinitionId: z.uuid().optional(),
  modelId: z.uuid().nullable().optional(),
  credentialMode: z.enum(CREDENTIAL_MODES).nullable().optional(),
  cliKind: z.enum(CLI_KINDS).nullable().optional(),
});
export const updateConversationSchema = createConversationSchema.partial();

export const messagePartSchema = z.object({
  id: z.uuid(),
  seq: z.number().int(),
  kind: z.enum(PART_KINDS),
  text: z.string().nullable(),
  toolName: z.string().nullable(),
  toolCallId: z.string().nullable(),
  arguments: z.unknown().nullable(),
  resultText: z.string().nullable(),
  isError: z.boolean().nullable(),
});
export type MessagePart = z.infer<typeof messagePartSchema>;

export const messageSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  role: z.enum(MESSAGE_ROLES),
  seq: z.number().int(),
  status: z.enum(MESSAGE_STATUSES),
  modelId: z.uuid().nullable(),
  credentialMode: z.enum(CREDENTIAL_MODES).nullable(),
  cliKind: z.enum(CLI_KINDS).nullable(),
  parts: z.array(messagePartSchema),
  createdAt: z.iso.datetime(),
});
export type Message = z.infer<typeof messageSchema>;

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(200_000),
  modelId: z.uuid().nullable().optional(),
  credentialMode: z.enum(CREDENTIAL_MODES).nullable().optional(),
  cliKind: z.enum(CLI_KINDS).nullable().optional(),
});
export type SendMessageRequest = z.infer<typeof sendMessageSchema>;

export const regenerateSchema = z.object({
  modelId: z.uuid().nullable().optional(),
  credentialMode: z.enum(CREDENTIAL_MODES).nullable().optional(),
  cliKind: z.enum(CLI_KINDS).nullable().optional(),
});

export const sandboxInfoSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  status: z.enum(SANDBOX_STATUSES),
  cpu: z.number(),
  memMb: z.number().int(),
  diskMb: z.number().int(),
  startedAt: z.iso.datetime().nullable(),
  stoppedAt: z.iso.datetime().nullable(),
  previewPorts: z.array(z.object({ port: z.number().int(), label: z.string() })),
});
export type SandboxInfo = z.infer<typeof sandboxInfoSchema>;

export const fileEntrySchema = z.object({
  path: z.string(),
  type: z.enum(['file', 'dir']),
  size: z.number().int(),
});
export type FileEntry = z.infer<typeof fileEntrySchema>;

export const writeFileSchema = z.object({ path: z.string().min(1).max(1024), content: z.string().max(5_000_000) });
export const execRequestSchema = z.object({
  command: z.string().min(1).max(10_000),
  timeoutS: z.number().int().min(1).max(3600).optional(),
});
export const addPreviewPortSchema = z.object({
  port: z.number().int().min(1).max(65535),
  label: z.string().trim().min(1).max(40).default('app'),
});

export const executionSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  command: z.string(),
  exitCode: z.number().int().nullable(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  timedOut: z.boolean(),
  actorUserId: z.uuid().nullable(),
});
export type Execution = z.infer<typeof executionSchema>;

export const testRunSchema = z.object({
  id: z.uuid(),
  executionId: z.uuid(),
  framework: z.string(),
  total: z.number().int().nullable(),
  passed: z.number().int().nullable(),
  failed: z.number().int().nullable(),
  summary: z.string(),
  createdAt: z.iso.datetime(),
});
export type TestRun = z.infer<typeof testRunSchema>;
