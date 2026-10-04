import { z } from 'zod';
import type { SandboxManager } from '../../sandbox/manager.js';
import { clip, defineTool, fail, ok } from '../define.js';
import type { Tool } from '../types.js';

/**
 * HTTP fetch runs with curl inside the project's sandbox, never from the API
 * process, so it is subject to the sandbox's network policy (no host, no LAN)
 * and cannot be used for SSRF against platform services.
 */
export function httpTools(sandbox: SandboxManager): Tool[] {
  return [
    defineTool({
      name: 'http_fetch',
      description: 'Fetch a URL over HTTP(S) from the sandbox network and return status, headers and (truncated) body.',
      permission: 'network',
      schema: z.object({
        url: z.url().refine((u) => /^https?:\/\//i.test(u), 'Only http and https URLs are allowed.'),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).optional(),
        headers: z.record(z.string().max(200), z.string().max(4000)).optional(),
        body: z.string().max(1_000_000).optional(),
      }),
      async run(ctx, a) {
        const argv = ['curl', '-sS', '-L', '--max-redirs', '5', '--max-time', '30', '-i', '-X', a.method ?? 'GET'];
        for (const [k, v] of Object.entries(a.headers ?? {})) argv.push('-H', `${k}: ${v}`);
        if (a.body !== undefined) argv.push('--data-binary', '@-');
        argv.push('--', a.url);
        const r = await sandbox.exec({
          projectId: ctx.projectId,
          argv,
          ...(a.body !== undefined ? { stdin: a.body } : {}),
          kind: 'shell',
          actorUserId: ctx.actorUserId,
          conversationId: ctx.conversationId,
          messagePartId: ctx.messagePartId,
          signal: ctx.signal,
          timeoutS: 40,
        });
        if (r.exitCode !== 0) return fail(clip(`Request failed (curl exit ${r.exitCode ?? 'unknown'}): ${r.stderr.trim()}`));
        return ok(clip(r.stdout, 40_000));
      },
    }),
  ];
}
