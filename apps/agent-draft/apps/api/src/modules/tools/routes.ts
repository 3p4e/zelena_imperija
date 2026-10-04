import type { FastifyInstance } from 'fastify';
import type { ToolCatalogEntry } from '@agent/shared';
import type { AppDeps } from '../../deps.js';
import { currentUser } from '../../auth/plugin.js';

export function registerToolRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/tools', async (req): Promise<ToolCatalogEntry[]> => {
    const user = currentUser(req);
    const rows = await deps.tools.catalogFor(user);
    return rows
      .filter((r) => user.role === 'admin' || r.allowedForMe)
      .map((r) => ({
        name: r.name,
        source: r.source,
        mcpServerId: user.role === 'admin' ? r.mcpServerId : null,
        description: r.description,
        permission: r.permission,
        requiresApproval: r.requiresApproval,
        enabled: r.enabled,
        allowedForMe: r.allowedForMe,
      }));
  });
}
