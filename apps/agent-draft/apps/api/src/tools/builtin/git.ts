import { z } from 'zod';
import type { SandboxManager } from '../../sandbox/manager.js';
import { clip, defineTool, fail, ok } from '../define.js';
import type { Tool, ToolContext } from '../types.js';

/** Git runs inside the sandbox with argv vectors (no shell), against the project's local repository. */
export function gitTools(sandbox: SandboxManager): Tool[] {
  const git = async (ctx: ToolContext, argv: string[]) => {
    const r = await sandbox.exec({
      projectId: ctx.projectId,
      argv: ['git', ...argv],
      kind: 'git',
      actorUserId: ctx.actorUserId,
      conversationId: ctx.conversationId,
      messagePartId: ctx.messagePartId,
      signal: ctx.signal,
      timeoutS: 60,
    });
    const text = clip([r.stdout, r.stderr].filter(Boolean).join('\n') || '(no output)');
    return r.exitCode === 0 ? ok(text) : fail(text);
  };

  return [
    defineTool({
      name: 'git_status',
      description: 'Show the working tree status of the project repository.',
      permission: 'read',
      schema: z.object({}),
      run: (ctx) => git(ctx, ['status', '--short', '--branch']),
    }),
    defineTool({
      name: 'git_diff',
      description: 'Show uncommitted changes (or staged changes with staged=true).',
      permission: 'read',
      schema: z.object({ staged: z.boolean().optional(), path: z.string().max(1024).optional() }),
      run: (ctx, a) => git(ctx, ['diff', ...(a.staged ? ['--cached'] : []), ...(a.path ? ['--', a.path] : [])]),
    }),
    defineTool({
      name: 'git_log',
      description: 'Show recent commits.',
      permission: 'read',
      schema: z.object({ limit: z.number().int().min(1).max(100).optional() }),
      run: (ctx, a) => git(ctx, ['log', '--oneline', '-n', String(a.limit ?? 20)]),
    }),
    defineTool({
      name: 'git_commit',
      description: 'Stage all changes and create a commit with the given message.',
      permission: 'write',
      schema: z.object({ message: z.string().min(1).max(2000) }),
      async run(ctx, a) {
        const add = await git(ctx, ['add', '-A']);
        if (add.isError) return add;
        return git(ctx, ['commit', '-m', a.message]);
      },
    }),
  ];
}
