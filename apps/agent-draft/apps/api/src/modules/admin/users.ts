import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import {
  createInviteRequestSchema,
  createUserRequestSchema,
  memberLimitsSchema,
  setToolRestrictionsSchema,
  updateUserStatusSchema,
  type AdminUserRow,
  type Invite,
} from '@agent/shared';
import type { AppDeps } from '../../deps.js';
import { conversations, invites, memberLimits, memberToolRestrictions, passwordResets, projects, sandboxes, users } from '../../db/schema/index.js';
import { currentUser } from '../../auth/plugin.js';
import { hashPassword } from '../../auth/password.js';
import { hashToken, newToken } from '../../lib/crypto.js';
import { AppError, notFound } from '../../lib/errors.js';
import { parseBody, requireUuid } from '../../lib/validate.js';
import { iso } from '../dto.js';

export function registerAdminUserRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  const issueResetLink = async (userId: string, hours: number): Promise<string> => {
    const token = newToken(32);
    await db.insert(passwordResets).values({ userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + hours * 3600_000) });
    return `${deps.config.PUBLIC_URL}/reset-password?token=${token}`;
  };

  app.get('/admin/users', async (): Promise<AdminUserRow[]> => {
    const rows = await db.select({ u: users, l: memberLimits }).from(users).leftJoin(memberLimits, eq(memberLimits.userId, users.id)).orderBy(asc(users.email));
    return rows.map(({ u, l }) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt.toISOString(),
      suspendedAt: iso(u.suspendedAt),
      lastSeenAt: iso(u.lastSeenAt),
      limits: l ? { sandboxCpu: l.sandboxCpu, sandboxMemMb: l.sandboxMemMb, sandboxDiskMb: l.sandboxDiskMb, maxContainers: l.maxContainers, networkMode: l.networkMode } : null,
    }));
  });

  app.post('/admin/users', async (req, reply) => {
    const admin = currentUser(req);
    const body = parseBody(createUserRequestSchema, req.body);
    const exists = await db.query.users.findFirst({ where: eq(users.email, body.email) });
    if (exists) throw new AppError('conflict', 'A user with this email already exists.');
    const [user] = await db
      .insert(users)
      .values({
        email: body.email,
        displayName: body.displayName,
        role: body.role,
        passwordHash: body.password ? await hashPassword(body.password) : null,
        createdByUserId: admin.id,
      })
      .returning();
    if (!user) throw new AppError('internal', 'Could not create the user.');
    await deps.audit(admin.id, 'admin.user_create', 'user', user.id, req.ip);
    // Without a password, return a one-time link the admin can hand over to set it.
    const setPasswordUrl = body.password ? null : await issueResetLink(user.id, 72);
    return reply.code(201).send({ id: user.id, email: user.email, role: user.role, setPasswordUrl });
  });

  app.patch('/admin/users/:id/status', async (req) => {
    const admin = currentUser(req);
    const id = requireUuid((req.params as { id: string }).id);
    const body = parseBody(updateUserStatusSchema, req.body);
    if (id === admin.id) throw new AppError('validation_failed', 'You cannot suspend your own account.');
    const user = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!user) throw notFound('User');
    await db
      .update(users)
      .set({ status: body.status, suspendedAt: body.status === 'suspended' ? new Date() : null })
      .where(eq(users.id, id));
    if (body.status === 'suspended') {
      await deps.sessions.destroyAllForUser(id);
      const owned = await db
        .select({ projectId: projects.id })
        .from(projects)
        .innerJoin(sandboxes, eq(sandboxes.projectId, projects.id))
        .where(and(eq(projects.ownerUserId, id), eq(sandboxes.status, 'running')));
      for (const p of owned) await deps.sandbox.stop(p.projectId);
      const convs = await db.select({ id: conversations.id }).from(conversations).innerJoin(projects, eq(projects.id, conversations.projectId)).where(eq(projects.ownerUserId, id));
      for (const c of convs) deps.agent.stop(c.id);
    }
    await deps.audit(admin.id, `admin.user_${body.status}`, 'user', id, req.ip);
    return { ok: true };
  });

  app.post('/admin/users/:id/reset-link', async (req) => {
    const admin = currentUser(req);
    const id = requireUuid((req.params as { id: string }).id);
    const user = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!user) throw notFound('User');
    const url = await issueResetLink(id, 24);
    await deps.audit(admin.id, 'admin.reset_link', 'user', id, req.ip);
    return { url, expiresInHours: 24 };
  });

  app.put('/admin/users/:id/limits', async (req) => {
    const id = requireUuid((req.params as { id: string }).id);
    const body = parseBody(memberLimitsSchema, req.body);
    const user = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!user) throw notFound('User');
    if (user.role === 'admin') throw new AppError('validation_failed', 'Admin limits are set in Settings.');
    await db
      .insert(memberLimits)
      .values({ userId: id, ...body })
      .onConflictDoUpdate({ target: memberLimits.userId, set: body });
    return body;
  });

  app.delete('/admin/users/:id/limits', async (req) => {
    const id = requireUuid((req.params as { id: string }).id);
    await db.delete(memberLimits).where(eq(memberLimits.userId, id));
    return { ok: true };
  });

  app.get('/admin/users/:id/tool-restrictions', async (req) => {
    const id = requireUuid((req.params as { id: string }).id);
    return db.select({ toolName: memberToolRestrictions.toolName, allowed: memberToolRestrictions.allowed }).from(memberToolRestrictions).where(eq(memberToolRestrictions.userId, id));
  });

  app.put('/admin/users/:id/tool-restrictions', async (req) => {
    const id = requireUuid((req.params as { id: string }).id);
    const body = parseBody(setToolRestrictionsSchema, req.body);
    const user = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!user) throw notFound('User');
    if (user.role === 'admin') throw new AppError('validation_failed', 'The admin always has every tool.');
    await db.transaction(async (tx) => {
      await tx.delete(memberToolRestrictions).where(eq(memberToolRestrictions.userId, id));
      if (body.restrictions.length > 0) await tx.insert(memberToolRestrictions).values(body.restrictions.map((r) => ({ userId: id, ...r })));
    });
    return body.restrictions;
  });

  app.get('/admin/invites', async (): Promise<Invite[]> => {
    const rows = await db.select().from(invites).where(isNull(invites.acceptedAt)).orderBy(desc(invites.createdAt));
    return rows.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt.toISOString(),
      acceptedAt: iso(i.acceptedAt),
      createdAt: i.createdAt.toISOString(),
    }));
  });

  app.post('/admin/invites', async (req, reply) => {
    const admin = currentUser(req);
    const body = parseBody(createInviteRequestSchema, req.body);
    const exists = await db.query.users.findFirst({ where: eq(users.email, body.email) });
    if (exists) throw new AppError('conflict', 'A user with this email already exists.');
    const token = newToken(32);
    const [row] = await db
      .insert(invites)
      .values({ email: body.email, role: body.role, tokenHash: hashToken(token), createdByUserId: admin.id, expiresAt: new Date(Date.now() + body.expiresInHours * 3600_000) })
      .returning();
    if (!row) throw new AppError('internal', 'Could not create invite.');
    const acceptUrl = `${deps.config.PUBLIC_URL}/invite?token=${token}`;
    let emailed = false;
    if (deps.mailer.configured) {
      await deps.mailer.send(body.email, 'You are invited', `You were invited to the agent workspace. Accept within ${body.expiresInHours} hours:\n\n${acceptUrl}`);
      emailed = true;
    }
    await deps.audit(admin.id, 'admin.invite', 'invite', row.id, req.ip);
    return reply.code(201).send({
      id: row.id,
      email: row.email,
      role: row.role,
      expiresAt: row.expiresAt.toISOString(),
      acceptedAt: null,
      createdAt: row.createdAt.toISOString(),
      acceptUrl,
      emailed,
    });
  });

  app.delete('/admin/invites/:id', async (req) => {
    const id = requireUuid((req.params as { id: string }).id);
    await db.delete(invites).where(eq(invites.id, id));
    return { ok: true };
  });
}
