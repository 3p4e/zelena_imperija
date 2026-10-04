import type { ToolPermission, ToolSource } from '@agent/shared';
import type { JsonSchema } from '@agent/providers';

export interface ToolContext {
  projectId: string;
  conversationId: string | null;
  /** The user on whose behalf the tool runs (owner or an edit-share collaborator). */
  actorUserId: string;
  /** Project owner; resource limits and the sandbox belong to them. */
  ownerUserId: string;
  messagePartId: string | null;
  signal: AbortSignal | undefined;
  /** Streams incremental output to the chat (shell output etc.). */
  onProgress?: (text: string) => void;
}

export interface ToolResult {
  /** Text sent back to the model and shown in the UI. */
  content: string;
  isError: boolean;
}

/** Authentication a tool needs before it can be used. Phase 1 tools need none beyond a running sandbox. */
export type ToolAuthRequirement = 'none' | 'sandbox' | 'mcp_server';

/**
 * The generic tool contract. Built-in tools and MCP tools both implement it; the
 * agent runtime and the permission checks only ever see this interface.
 */
export interface Tool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  permission: ToolPermission;
  source: ToolSource;
  requiresApproval: boolean;
  auth: ToolAuthRequirement;
  mcpServerId: string | null;
  /** Validates and normalises raw model-supplied arguments; throws ToolInputError on failure. */
  parse(args: unknown): unknown;
  handler(ctx: ToolContext, args: unknown): Promise<ToolResult>;
}

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}
