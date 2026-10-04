import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import type { AppDeps } from './deps.js';
import { corsOrigins } from './config/env.js';
import { AppError, fromProviderError, isProviderError } from './lib/errors.js';
import { authPlugin, requireAuth } from './auth/plugin.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerAdminRoutes } from './modules/admin/routes.js';
import { registerProviderRoutes } from './modules/providers/routes.js';
import { registerKeyRoutes } from './modules/keys/routes.js';
import { registerProjectRoutes } from './modules/projects/routes.js';
import { registerConversationRoutes } from './modules/conversations/routes.js';
import { registerSandboxRoutes } from './modules/sandbox/routes.js';
import { registerUsageRoutes } from './modules/usage/routes.js';
import { registerToolRoutes } from './modules/tools/routes.js';
import { registerPreviewProxy } from './modules/preview/proxy.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Marks a route as reachable without a session. Everything else requires one. */
    public?: boolean;
  }
  interface FastifyInstance {
    /** Every registered route with its auth requirement; used by the security test suite. */
    routeTable: { method: string; url: string; public: boolean }[];
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  // The logger type parameter is positional; the preceding defaults must be spelled out to widen it.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-arguments
  const app = Fastify<Server, IncomingMessage, ServerResponse<IncomingMessage>, FastifyBaseLogger>({
    loggerInstance: deps.log,
    trustProxy: deps.config.TRUST_PROXY,
    bodyLimit: 6 * 1024 * 1024,
    // Signed preview tokens are passed as a path parameter.
    routerOptions: { maxParamLength: 512 },
  });

  await app.register(cookie);
  await app.register(cors, { origin: corsOrigins(deps.config), credentials: true });
  await app.register(rateLimit, { global: false });
  await app.register(websocket);
  await app.register(authPlugin, { deps });

  // HTTPS enforcement: anything not on localhost must arrive over TLS (directly or via the proxy).
  app.addHook('onRequest', async (req, reply) => {
    if (!deps.config.REQUIRE_HTTPS) return;
    const host = req.hostname.split(':')[0] ?? '';
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (isLocal) return;
    if (req.protocol === 'https') return;
    const target = `https://${req.headers.host ?? host}${req.url}`;
    return reply.code(308).header('location', target).send();
  });

  // Default-deny: every route requires a session unless it opted into `public`.
  const routeTable: FastifyInstance['routeTable'] = [];
  app.decorate('routeTable', routeTable);
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods)
      routeTable.push({ method, url: route.url, public: route.config?.public === true });
    if (route.config?.public) return;
    const existing = route.preHandler;
    const handlers = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
    if (!handlers.includes(requireAuth)) route.preHandler = [requireAuth, ...handlers];
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send(err.toBody());
    }
    if (isProviderError(err)) {
      const mapped = fromProviderError(err);
      return reply.code(mapped.status).send(mapped.toBody());
    }
    if (err instanceof ZodError) {
      return reply
        .code(400)
        .send({ error: { code: 'validation_failed', message: 'Request validation failed.' } });
    }
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status === 429)
      return reply.code(429).send({ error: { code: 'rate_limited', message: 'Too many requests.' } });
    if (status >= 500) {
      req.log.error({ err: { name: err.name, message: err.message, code: err.code } }, 'unhandled error');
      return reply.code(500).send({ error: { code: 'internal', message: 'Internal error.' } });
    }
    return reply.code(status).send({ error: { code: 'validation_failed', message: err.message } });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } }),
  );

  app.get('/healthz', { config: { public: true } }, async () => ({ ok: true }));

  await app.register(
    async (api) => {
      registerAuthRoutes(api, deps);
      registerAdminRoutes(api, deps);
      registerProviderRoutes(api, deps);
      registerKeyRoutes(api, deps);
      registerProjectRoutes(api, deps);
      registerConversationRoutes(api, deps);
      registerSandboxRoutes(api, deps);
      registerUsageRoutes(api, deps);
      registerToolRoutes(api, deps);
    },
    { prefix: '/api' },
  );
  await registerPreviewProxy(app, deps);

  return app;
}
