import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  createConversationSchema,
  regenerateSchema,
  sendMessageSchema,
  updateConversationSchema,
} from '@agent/shared';
import type { AppDeps } from '../../deps.js';
import { agentDefinitions, conversations, messageParts, messages } from '../../db/schema/index.js';
import { currentUser } from '../../auth/plugin.js';
import { AppError } from '../../lib/errors.js';
import { openSse } from '../../lib/sse.js';
import { parseBody } from '../../lib/validate.js';
import { conversationDto, messageDto } from '../dto.js';
import { assertModeAllowed, conversationFor, projectFor } from '../projects/access.js';

export function registerConversationRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  /** Streams the conversation's active run to the client until it ends. */
  const streamRun = (req: FastifyRequest, reply: FastifyReply, conversationId: string): void => {
    const sse = openSse(req, reply);
    const unsubscribe = deps.agent.bus.subscribe(
      conversationId,
      (ev) => sse.send(ev),
      () => sse.close(),
    );
    sse.onClose(unsubscribe);
  };

  app.get('/projects/:id/conversations', async (req) => {
    const user = currentUser(req);
    const { project } = await projectFor(db, user, (req.params as { id: string }).id, 'read');
    const rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.projectId, project.id))
      .orderBy(desc(conversations.updatedAt));
    return rows.map(conversationDto);
  });

  app.post('/projects/:id/conversations', async (req, reply) => {
    const user = currentUser(req);
    const { project } = await projectFor(db, user, (req.params as { id: string }).id, 'edit');
    const body = parseBody(createConversationSchema, req.body);
    assertModeAllowed(user, body.credentialMode);
    const agent = body.agentDefinitionId
      ? await db.query.agentDefinitions.findFirst({
          where: and(eq(agentDefinitions.id, body.agentDefinitionId), eq(agentDefinitions.enabled, true)),
        })
      : await db.query.agentDefinitions.findFirst({
          where: and(eq(agentDefinitions.isPrimary, true), eq(agentDefinitions.enabled, true)),
        });
    if (!agent) throw new AppError('validation_failed', 'No enabled agent is configured.');
    const [row] = await db
      .insert(conversations)
      .values({
        projectId: project.id,
        title: body.title ?? 'New conversation',
        agentDefinitionId: agent.id,
        modelId: body.modelId ?? null,
        credentialMode: body.credentialMode ?? null,
        cliKind: user.role === 'admin' ? (body.cliKind ?? null) : null,
      })
      .returning();
    if (!row) throw new AppError('internal', 'Could not create conversation.');
    return reply.code(201).send(conversationDto(row));
  });

  app.patch('/conversations/:id', async (req) => {
    const user = currentUser(req);
    const { conversation } = await conversationFor(db, user, (req.params as { id: string }).id, 'edit');
    const body = parseBody(updateConversationSchema, req.body);
    assertModeAllowed(user, body.credentialMode);
    const [row] = await db
      .update(conversations)
      .set({
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.modelId !== undefined ? { modelId: body.modelId } : {}),
        ...(body.credentialMode !== undefined ? { credentialMode: body.credentialMode } : {}),
        ...(body.cliKind !== undefined && user.role === 'admin' ? { cliKind: body.cliKind } : {}),
      })
      .where(eq(conversations.id, conversation.id))
      .returning();
    if (!row) throw new AppError('not_found', 'Conversation not found.');
    return conversationDto(row);
  });

  app.delete('/conversations/:id', async (req) => {
    const user = currentUser(req);
    const { conversation } = await conversationFor(db, user, (req.params as { id: string }).id, 'edit');
    deps.agent.stop(conversation.id);
    await db.delete(conversations).where(eq(conversations.id, conversation.id));
    return { ok: true };
  });

  app.get('/conversations/:id/messages', async (req) => {
    const user = currentUser(req);
    const { conversation } = await conversationFor(db, user, (req.params as { id: string }).id, 'read');
    const rows = await db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversation.id), eq(messages.superseded, false)))
      .orderBy(asc(messages.seq));
    const parts =
      rows.length === 0
        ? []
        : await db
            .select()
            .from(messageParts)
            .where(
              inArray(
                messageParts.messageId,
                rows.map((r) => r.id),
              ),
            )
            .orderBy(asc(messageParts.seq));
    return {
      conversation: conversationDto(conversation),
      running: deps.agent.isRunning(conversation.id),
      messages: rows.map((m) =>
        messageDto(
          m,
          parts.filter((p) => p.messageId === m.id),
        ),
      ),
    };
  });

  app.post('/conversations/:id/messages', async (req, reply) => {
    const user = currentUser(req);
    const { conversation } = await conversationFor(db, user, (req.params as { id: string }).id, 'edit');
    const body = parseBody(sendMessageSchema, req.body);
    assertModeAllowed(user, body.credentialMode);
    await deps.agent.start({
      conversationId: conversation.id,
      actor: { id: user.id, role: user.role },
      content: body.content,
      selection: { modelId: body.modelId, credentialMode: body.credentialMode, cliKind: body.cliKind },
    });
    streamRun(req, reply, conversation.id);
  });

  app.post('/conversations/:id/regenerate', async (req, reply) => {
    const user = currentUser(req);
    const { conversation } = await conversationFor(db, user, (req.params as { id: string }).id, 'edit');
    const body = parseBody(regenerateSchema, req.body ?? {});
    assertModeAllowed(user, body.credentialMode);
    await deps.agent.start({
      conversationId: conversation.id,
      actor: { id: user.id, role: user.role },
      content: null,
      selection: { modelId: body.modelId, credentialMode: body.credentialMode, cliKind: body.cliKind },
    });
    streamRun(req, reply, conversation.id);
  });

  app.post('/conversations/:id/stop', async (req) => {
    const user = currentUser(req);
    const { conversation } = await conversationFor(db, user, (req.params as { id: string }).id, 'edit');
    return { stopped: deps.agent.stop(conversation.id) };
  });

  app.get('/conversations/:id/events', async (req, reply) => {
    const user = currentUser(req);
    const { conversation } = await conversationFor(db, user, (req.params as { id: string }).id, 'read');
    streamRun(req, reply, conversation.id);
  });
}
