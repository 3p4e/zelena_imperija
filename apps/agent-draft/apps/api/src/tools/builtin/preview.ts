import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { previewPorts } from '../../db/schema/index.js';
import type { SandboxManager } from '../../sandbox/manager.js';
import { defineTool, fail, ok } from '../define.js';
import type { Tool } from '../types.js';

export function previewTools(sandbox: SandboxManager, db: Db): Tool[] {
  return [
    defineTool({
      name: 'preview_register',
      description:
        'Expose an HTTP server running in the sandbox in the Preview panel. Optionally start it first with `command` (it runs in the background and must listen on 0.0.0.0:<port>).',
      permission: 'exec',
      schema: z.object({
        port: z.number().int().min(1024).max(65535),
        label: z.string().min(1).max(40).optional(),
        command: z.string().min(1).max(4000).optional(),
      }),
      async run(ctx, a) {
        let logNote = '';
        if (a.command) {
          const log = await sandbox.startBackground(ctx.projectId, a.command, `preview-${a.port}`, ctx.actorUserId);
          logNote = ` Server log: ${log}.`;
        }
        const row = await sandbox.info(ctx.projectId);
        if (!row) return fail('Sandbox is not running.');
        await db
          .insert(previewPorts)
          .values({ sandboxId: row.id, port: a.port, label: a.label ?? 'app' })
          .onConflictDoUpdate({ target: [previewPorts.sandboxId, previewPorts.port], set: { label: a.label ?? 'app' } });

        // Wait briefly for the server to accept connections so the preview opens on a live page.
        const probe = await sandbox.exec({
          projectId: ctx.projectId,
          argv: [
            'bash',
            '-c',
            `for i in $(seq 1 30); do curl -s -o /dev/null -m 2 http://127.0.0.1:${a.port}/ && exit 0; sleep 1; done; exit 1`,
          ],
          kind: 'preview',
          actorUserId: ctx.actorUserId,
          conversationId: ctx.conversationId,
          signal: ctx.signal,
          timeoutS: 40,
        });
        if (probe.exitCode !== 0) {
          return fail(`Port ${a.port} registered, but nothing answered on it within 30 s.${logNote} Check the server log and that it binds 0.0.0.0.`);
        }
        return ok(`Preview is live on port ${a.port}; it is shown in the Preview panel.${logNote}`);
      },
    }),
  ];
}
