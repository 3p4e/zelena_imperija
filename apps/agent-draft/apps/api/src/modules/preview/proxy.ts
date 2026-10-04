import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { eq } from 'drizzle-orm';
import type { AppDeps } from '../../deps.js';
import { users } from '../../db/schema/index.js';
import { verifyPreviewToken } from '../../sandbox/preview-token.js';
import { projectFor } from '../projects/access.js';
import type { SessionUser } from '../../auth/session.js';

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'cookie', 'authorization', 'content-length']);
const STRIP_RESPONSE = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length', 'content-security-policy', 'x-frame-options', 'set-cookie']);

/**
 * Reverse proxy for sandbox previews: /preview/<signed token>/<path>.
 * The token authenticates (iframes cannot carry the Lax session cookie from an
 * opaque origin). Each request re-checks that the token's user is still active
 * and still has access to the project. Responses are forced into a CSP sandbox
 * so agent-generated pages never run with the platform's origin.
 */
export async function registerPreviewProxy(app: FastifyInstance, deps: AppDeps): Promise<void> {
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_req, payload, done) => done(null, payload));

    scope.all('/preview/:token/*', { config: { public: true } }, async (req, reply) => {
      const params = req.params as { token: string; '*': string };
      const claims = verifyPreviewToken(deps.vault, params.token);
      if (!claims) return reply.code(403).type('text/plain').send('Preview link is invalid or expired. Reopen the preview from the workspace.');
      const user = await deps.db.query.users.findFirst({ where: eq(users.id, claims.userId) });
      if (user?.status !== 'active') return reply.code(403).type('text/plain').send('Access denied.');
      const sessionUser: SessionUser = { ...user, sessionId: '' };
      try {
        await projectFor(deps.db, sessionUser, claims.projectId, 'read');
      } catch {
        return reply.code(403).type('text/plain').send('Access denied.');
      }
      const sbx = await deps.sandbox.info(claims.projectId);
      const ports = sbx ? await deps.sandbox.previewPortsFor(sbx.id) : [];
      if (sbx?.status !== 'running' || !ports.some((p) => p.port === claims.port)) {
        return reply.code(502).type('text/plain').send('The sandbox is not running or this port is no longer exposed.');
      }

      let ip: string;
      try {
        ip = await deps.sandbox.containerIp(claims.projectId);
      } catch {
        return reply.code(502).type('text/plain').send('The sandbox has no network.');
      }
      const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      const target = `http://${ip}:${claims.port}/${params['*']}${query}`;

      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (HOP_BY_HOP.has(k) || v === undefined) continue;
        headers[k] = Array.isArray(v) ? v.join(', ') : v;
      }
      headers['x-forwarded-prefix'] = `/preview/${params.token}`;

      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      let upstream: Response;
      try {
        upstream = await fetch(target, {
          method: req.method,
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(60_000),
          ...(hasBody ? { body: Readable.toWeb(req.body as Readable) as ReadableStream, duplex: 'half' } : {}),
        });
      } catch {
        return reply.code(502).type('text/plain').send(`Nothing is answering on port ${claims.port} in the sandbox.`);
      }

      reply.code(upstream.status);
      upstream.headers.forEach((value, key) => {
        if (STRIP_RESPONSE.has(key)) return;
        if (key === 'location' && value.startsWith('/')) {
          reply.header('location', `/preview/${params.token}${value}`);
          return;
        }
        reply.header(key, value);
      });
      reply.header('content-security-policy', "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads; frame-ancestors 'self'");
      reply.header('x-content-type-options', 'nosniff');
      reply.header('referrer-policy', 'no-referrer');
      if (!upstream.body) return reply.send();
      return reply.send(Readable.fromWeb(upstream.body as NodeReadableStream));
    });
  });
}
