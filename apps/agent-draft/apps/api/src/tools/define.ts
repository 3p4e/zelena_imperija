import { z, type ZodType } from 'zod';
import type { ToolPermission } from '@agent/shared';
import type { JsonSchema } from '@agent/providers';
import { ToolInputError, type Tool, type ToolAuthRequirement, type ToolContext, type ToolResult } from './types.js';

export interface BuiltinToolSpec<S extends ZodType> {
  name: string;
  description: string;
  schema: S;
  permission: ToolPermission;
  auth?: ToolAuthRequirement;
  requiresApproval?: boolean;
  run: (ctx: ToolContext, args: z.infer<S>) => Promise<ToolResult>;
}

/** Builds a Tool from a zod schema: one source of truth for validation and the JSON Schema sent to models. */
export function defineTool<S extends ZodType>(spec: BuiltinToolSpec<S>): Tool {
  const inputSchema = z.toJSONSchema(spec.schema, { target: 'draft-7' }) as JsonSchema;
  delete inputSchema.$schema;
  return {
    name: spec.name,
    description: spec.description,
    inputSchema,
    permission: spec.permission,
    source: 'builtin',
    requiresApproval: spec.requiresApproval ?? false,
    auth: spec.auth ?? 'sandbox',
    mcpServerId: null,
    parse(args) {
      const r = spec.schema.safeParse(args ?? {});
      if (!r.success) {
        throw new ToolInputError(r.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
      }
      return r.data;
    },
    handler: (ctx, args) => spec.run(ctx, args as z.infer<S>),
  };
}

export const ok = (content: string): ToolResult => ({ content, isError: false });
export const fail = (content: string): ToolResult => ({ content, isError: true });

/** Keeps tool output within what is sensible to send back to a model. */
export function clip(text: string, max = 30_000): string {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.floor(max * 0.6));
  const tail = text.slice(-Math.floor(max * 0.35));
  return `${head}\n…[${text.length - head.length - tail.length} characters omitted]…\n${tail}`;
}
