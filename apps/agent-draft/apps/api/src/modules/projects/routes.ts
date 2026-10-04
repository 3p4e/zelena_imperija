import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { createProjectSchema, updateProjectSchema, upsertProjectShareSchema } from '@agent/shared';
import type { AppDeps } from '../../deps.js';
import { agentDefinitions, conversations, projectShares, projects, users } from '../../db/schema/index.js';
import { currentUser } from '../../auth/plugin.js';
import { AppError } from '../../lib/errors.js';
import { parseBody, requireUuid } from '../../lib/validate.js';
import { projectDto } from '../dto.js';
import { assertModeAllowed, projectFor } from './access.js';

export function registerProjectRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  app.get('/projects', async (req) => {
    const user = currentUser(req);
    const shared = await db
      .select({ projectId: projectShares.projectId, permission: projectShares.permission })
      .from(projectShares)
      .where(eq(projectShares.userId, user.id));
    const sharedIds = shared.map((s) => s.projectId);
    const rows = await db
      .select()
      .from(projects)
      .where(
        sharedIds.length > 0
          ? or(eq(projects.ownerUserId, user.id), inArray(projects.id, sharedIds))
          : eq(projects.ownerUserId, user.id),
      )
      .orderBy(desc(projects.updatedAt));
    const perm = new Map(shared.map((s) => [s.projectId, s.permission]));
    return rows.map((p) => projectDto(p, p.ownerUserId === user.id ? 'owner' : (perm.get(p.id) ?? 'read')));
  });

  app.post('/projects', async (req, reply) => {
    const user = currentUser(req);
    const body = parseBody(createProjectSchema, req.body);
    assertModeAllowed(user, body.defaultCredentialMode);
    const [project] = await db
      .insert(projects)
      .values({
        ownerUserId: user.id,
        name: body.name,
        description: body.description ?? null,
        defaultModelId: body.defaultModelId ?? null,
        defaultCredentialMode: body.defaultCredentialMode ?? null,
        defaultCliKind: user.role === 'admin' ? (body.defaultCliKind ?? null) : null,
        sandboxImage: deps.config.SANDBOX_IMAGE,
      })
      .returning();
    if (!project) throw new AppError('internal', 'Could not create project.');
    const primary = await db.query.agentDefinitions.findFirst({
      where: and(eq(agentDefinitions.isPrimary, true), eq(agentDefinitions.enabled, true)),
    });
    if (primary) {
      await db
        .insert(conversations)
        .values({ projectId: project.id, title: 'New conversation', agentDefinitionId: primary.id });
    }
    await deps.audit(user.id, 'project.create', 'project', project.id, req.ip);
    return reply.code(201).send(projectDto(project, 'owner'));
  });

  app.get('/projects/:id', async (req) => {
    const user = currentUser(req);
    const { project, permission } = await projectFor(db, user, (req.params as { id: string }).id, 'read');
    return projectDto(project, permission);
  });

  app.patch('/projects/:id', async (req) => {
    const user = currentUser(req);
    const { project } = await projectFor(db, user, (req.params as { id: string }).id, 'owner');
    const body = parseBody(updateProjectSchema, req.body);
    assertModeAllowed(user, body.defaultCredentialMode);
    if (body.sandboxImage !== undefined && user.role !== 'admin')
      throw new AppError('forbidden', 'Only the admin can change the sandbox image.');
    const [updated] = await db
      .update(projects)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.defaultModelId !== undefined ? { defaultModelId: body.defaultModelId } : {}),
        ...(body.defaultCredentialMode !== undefined
          ? { defaultCredentialMode: body.defaultCredentialMode }
          : {}),
        ...(body.defaultCliKind !== undefined && user.role === 'admin'
          ? { defaultCliKind: body.defaultCliKind }
          : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.sandboxImage !== undefined ? { sandboxImage: body.sandboxImage } : {}),
      })
      .where(eq(projects.id, project.id))
      .returning();
    if (!updated) throw new AppError('not_found', 'Project not found.');
    return projectDto(updated, 'owner');
  });

  app.delete('/projects/:id', async (req) => {
    const user = currentUser(req);
    const { project } = await projectFor(db, user, (req.params as { id: string }).id, 'owner');
    const convs = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.projectId, project.id));
    for (const c of convs) deps.agent.stop(c.id);
    await deps.sandbox.destroy(project.id);
    await db.delete(projects).where(eq(projects.id, project.id));
    await deps.audit(user.id, 'project.delete', 'project', project.id, req.ip);
    return { ok: true };
  });

  app.get('/projects/:id/shares', async (req) => {
    const user = currentUser(req);
    const { project } = await projectFor(db, user, (req.params as { id: string }).id, 'owner');
    return db
      .select({ userId: projectShares.userId, email: users.email, permission: projectShares.permission })
      .from(projectShares)
      .innerJoin(users, eq(users.id, projectShares.userId))
      .where(eq(projectShares.projectId, project.id));
  });

  app.put('/projects/:id/shares', async (req) => {
    const user = currentUser(req);
    const { project } = await projectFor(db, user, (req.params as { id: string }).id, 'owner');
    const body = parseBody(upsertProjectShareSchema, req.body);
    const target = await db.query.users.findFirst({ where: eq(users.email, body.email) });
    // Same answer for unknown and suspended users; do not reveal who has an account beyond "not shareable".
    if (target?.status !== 'active') throw new AppError('not_found', 'No active user with that email.');
    if (target.id === user.id) throw new AppError('validation_failed', 'You already own this project.');
    await db
      .insert(projectShares)
      .values({ projectId: project.id, userId: target.id, permission: body.permission })
      .onConflictDoUpdate({
        target: [projectShares.projectId, projectShares.userId],
        set: { permission: body.permission },
      });
    await deps.audit(user.id, 'project.share', 'project', project.id, req.ip);
    return { userId: target.id, email: target.email, permission: body.permission };
  });

  app.delete('/projects/:id/shares/:userId', async (req) => {
    const user = currentUser(req);
    const params = req.params as { id: string; userId: string };
    const { project } = await projectFor(db, user, params.id, 'owner');
    await db
      .delete(projectShares)
      .where(
        and(eq(projectShares.projectId, project.id), eq(projectShares.userId, requireUuid(params.userId))),
      );
    return { ok: true };
  });
}
