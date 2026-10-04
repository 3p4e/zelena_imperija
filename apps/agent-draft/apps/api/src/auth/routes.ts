import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt, isNull } from 'drizzle-orm';
import {
  acceptInviteRequestSchema,
  changePasswordSchema,
  completePasswordResetSchema,
  loginRequestSchema,
  requestPasswordResetSchema,
  type MeResponse,
} from '@agent/shared';
import type { AppDeps } from '../deps.js';
import { invites, passwordResets, users } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import { hashToken, newToken } from '../lib/crypto.js';
import { parseBody } from '../lib/validate.js';
import { hashPassword, verifyPassword } from './password.js';
import { SESSION_COOKIE } from './session.js';
import { currentUser, requireAuth } from './plugin.js';

export function setSessionCookie(deps: AppDeps, reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: deps.config.PUBLIC_URL.startsWith('https://'),
    path: '/',
    expires: expiresAt,
  });
}

export function toMe(req: FastifyRequest, deps: AppDeps): MeResponse {
  const u = currentUser(req);
  return {
    user: {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt.toISOString(),
    },
    capabilities: {
      admin: u.role === 'admin',
      subscriptionCli: u.role === 'admin' && deps.config.CLI_RUNNER_ENABLED,
    },
  };
}

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Coarse per-IP flood guard; credential guessing is handled by the DB-backed throttle below.
  app.post(
    '/auth/login',
    { config: { public: true, rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parseBody(loginRequestSchema, req.body);
      const subjects = [`email:${body.email}`, `ip:${req.ip}`];
      if (await deps.loginThrottle.isBlocked(subjects)) {
        throw new AppError('rate_limited', 'Too many failed login attempts. Try again later.');
      }
      const user = await deps.db.query.users.findFirst({ where: eq(users.email, body.email) });
      const ok = await verifyPassword(user?.passwordHash ?? null, body.password);
      if (!user || !ok) {
        await deps.loginThrottle.record(subjects, false);
        throw new AppError('unauthenticated', 'Invalid email or password.');
      }
      if (user.status === 'suspended') throw new AppError('forbidden', 'This account is suspended.');
      await deps.loginThrottle.record(subjects, true);
      const session = await deps.sessions.create(user.id, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      setSessionCookie(deps, reply, session.token, session.expiresAt);
      await deps.audit(user.id, 'auth.login', 'user', user.id, req.ip);
      req.user = { ...user, sessionId: '' };
      return toMe(req, deps);
    },
  );

  app.post('/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    if (req.sessionToken) await deps.sessions.destroy(req.sessionToken);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (req) => toMe(req, deps));

  app.post('/auth/invites/accept', { config: { public: true } }, async (req, reply) => {
    const body = parseBody(acceptInviteRequestSchema, req.body);
    const invite = await deps.db.query.invites.findFirst({
      where: and(
        eq(invites.tokenHash, hashToken(body.token)),
        isNull(invites.acceptedAt),
        gt(invites.expiresAt, new Date()),
      ),
    });
    if (!invite) throw new AppError('not_found', 'This invite is invalid or has expired.');
    const existing = await deps.db.query.users.findFirst({ where: eq(users.email, invite.email) });
    if (existing) throw new AppError('conflict', 'An account with this email already exists.');
    const passwordHash = await hashPassword(body.password);
    const [user] = await deps.db
      .insert(users)
      .values({
        email: invite.email,
        passwordHash,
        displayName: body.displayName,
        role: invite.role,
        createdByUserId: invite.createdByUserId,
      })
      .returning();
    if (!user) throw new AppError('internal', 'Could not create the account.');
    await deps.db.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, invite.id));
    const session = await deps.sessions.create(user.id, { ip: req.ip, userAgent: req.headers['user-agent'] });
    setSessionCookie(deps, reply, session.token, session.expiresAt);
    await deps.audit(user.id, 'auth.invite_accepted', 'user', user.id, req.ip);
    req.user = { ...user, sessionId: '' };
    return toMe(req, deps);
  });

  app.post(
    '/auth/password-reset/request',
    { config: { public: true, rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req) => {
      const body = parseBody(requestPasswordResetSchema, req.body);
      const user = await deps.db.query.users.findFirst({ where: eq(users.email, body.email) });
      // Always answer the same way so emails cannot be enumerated.
      if (user?.status === 'active') {
        const token = newToken(32);
        await deps.db.insert(passwordResets).values({
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 60 * 60_000),
        });
        const url = `${deps.config.PUBLIC_URL}/reset-password?token=${token}`;
        if (deps.mailer.configured) {
          await deps.mailer.send(
            user.email,
            'Reset your password',
            `Open this link within one hour to set a new password:\n\n${url}`,
          );
        } else {
          deps.log.warn(
            { userId: user.id },
            'password reset requested but SMTP is not configured; admin can issue a link from the admin page',
          );
        }
      }
      return { ok: true, delivery: deps.mailer.configured ? 'email' : 'admin' };
    },
  );

  app.post(
    '/auth/password-reset/complete',
    { config: { public: true, rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req) => {
      const body = parseBody(completePasswordResetSchema, req.body);
      const reset = await deps.db.query.passwordResets.findFirst({
        where: and(
          eq(passwordResets.tokenHash, hashToken(body.token)),
          isNull(passwordResets.usedAt),
          gt(passwordResets.expiresAt, new Date()),
        ),
      });
      if (!reset) throw new AppError('not_found', 'This reset link is invalid or has expired.');
      const passwordHash = await hashPassword(body.password);
      await deps.db.update(users).set({ passwordHash }).where(eq(users.id, reset.userId));
      await deps.db.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, reset.id));
      await deps.sessions.destroyAllForUser(reset.userId);
      await deps.audit(reset.userId, 'auth.password_reset', 'user', reset.userId, req.ip);
      return { ok: true };
    },
  );

  app.post('/auth/password', { preHandler: requireAuth }, async (req) => {
    const user = currentUser(req);
    const body = parseBody(changePasswordSchema, req.body);
    const row = await deps.db.query.users.findFirst({ where: eq(users.id, user.id) });
    if (!(await verifyPassword(row?.passwordHash ?? null, body.currentPassword))) {
      throw new AppError('forbidden', 'Current password is incorrect.');
    }
    await deps.db
      .update(users)
      .set({ passwordHash: await hashPassword(body.newPassword) })
      .where(eq(users.id, user.id));
    return { ok: true };
  });
}
