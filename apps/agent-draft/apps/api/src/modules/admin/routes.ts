import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../deps.js';
import { requireAdmin } from '../../auth/plugin.js';
import { registerAdminRegistryRoutes } from './registry.js';
import { registerAdminSettingsRoutes } from './settings.js';
import { registerAdminUserRoutes } from './users.js';

/** Every route registered here requires an authenticated, active admin. */
export function registerAdminRoutes(app: FastifyInstance, deps: AppDeps): void {
  void app.register(async (admin) => {
    admin.addHook('preHandler', requireAdmin);
    registerAdminUserRoutes(admin, deps);
    registerAdminSettingsRoutes(admin, deps);
    registerAdminRegistryRoutes(admin, deps);
  });
}
