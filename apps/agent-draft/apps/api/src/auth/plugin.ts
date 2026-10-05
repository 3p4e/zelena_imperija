import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE, type SessionUser } from './session.js';
import { AppError, forbidden, unauthenticated } from '../lib/errors.js';
import type { AppDeps } from '../deps.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    sessionToken: string | null;
  }
}

/**
 * Resolves the session cookie on every request. Routes opt in to protection
 * with the `requireAuth` / `requireAdmin` preHandlers; nothing is public by
 * accident because the route registrar applies `requireAuth` by default.
 */
export const authPlugin = fp<{ deps: AppDeps }>((app, { deps }, done) => {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);

  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const user = await deps.sessions.resolve(token);
    if (!user) return;
    req.user = user;
    req.sessionToken = token;
  });

  done();
});

export async function requireAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!req.user) throw unauthenticated();
  if (req.user.status === 'suspended') throw new AppError('forbidden', 'This account is suspended.');
  // A one-time password only buys access to the password change itself.
  if (req.user.mustChangePassword && req.routeOptions.config.allowPasswordChange !== true) {
    throw new AppError('forbidden', 'You must change your one-time password before continuing.');
  }
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(req, reply);
  if (req.user?.role !== 'admin') throw forbidden('Admin access required.');
}

export function currentUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthenticated();
  return req.user;
}
