import type { Conversation, Message, MessagePart, Model, Project } from '@agent/shared';
import type { conversations, messageParts, messages, models, projects, providers } from '../db/schema/index.js';
import type { Permission } from './projects/access.js';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const numOrNull = (v: string | null): number | null => (v === null ? null : Number(v));

export function projectDto(p: typeof projects.$inferSelect, permission: Permission): Project {
  return {
    id: p.id,
    ownerUserId: p.ownerUserId,
    name: p.name,
    description: p.description,
    defaultModelId: p.defaultModelId,
    defaultCredentialMode: p.defaultCredentialMode,
    defaultCliKind: p.defaultCliKind,
    sandboxImage: p.sandboxImage,
    status: p.status,
    myPermission: permission,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function conversationDto(c: typeof conversations.$inferSelect): Conversation {
  return {
    id: c.id,
    projectId: c.projectId,
    title: c.title,
    agentDefinitionId: c.agentDefinitionId,
    modelId: c.modelId,
    credentialMode: c.credentialMode,
    cliKind: c.cliKind,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function partDto(p: typeof messageParts.$inferSelect): MessagePart {
  return {
    id: p.id,
    seq: p.seq,
    kind: p.kind,
    text: p.text,
    toolName: p.toolName,
    toolCallId: p.toolCallId,
    arguments: p.arguments,
    resultText: p.resultText,
    isError: p.isError,
  };
}

export function messageDto(m: typeof messages.$inferSelect, parts: (typeof messageParts.$inferSelect)[]): Message {
  return {
    id: m.id,
    conversationId: m.conversationId,
    role: m.role,
    seq: m.seq,
    status: m.status,
    modelId: m.modelId,
    credentialMode: m.credentialMode,
    cliKind: m.cliKind,
    parts: parts.map(partDto),
    createdAt: m.createdAt.toISOString(),
  };
}

export function modelDto(m: typeof models.$inferSelect, p: Pick<typeof providers.$inferSelect, 'slug' | 'kind'>): Model {
  return {
    id: m.id,
    providerId: m.providerId,
    providerSlug: p.slug,
    providerKind: p.kind,
    modelId: m.modelId,
    displayName: m.displayName,
    contextWindow: m.contextWindow,
    maxOutput: m.maxOutput,
    inputPricePerMtok: numOrNull(m.inputPricePerMtok),
    outputPricePerMtok: numOrNull(m.outputPricePerMtok),
    cachedInputPricePerMtok: numOrNull(m.cachedInputPricePerMtok),
    supportsVision: m.supportsVision,
    supportsTools: m.supportsTools,
    supportsReasoning: m.supportsReasoning,
    supportsStructuredOutput: m.supportsStructuredOutput,
    available: m.available,
    source: m.source,
    lastFetchedAt: iso(m.lastFetchedAt),
  };
}

export { iso };
