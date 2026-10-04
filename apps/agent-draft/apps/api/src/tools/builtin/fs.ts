import { z } from 'zod';
import type { SandboxManager } from '../../sandbox/manager.js';
import { AppError } from '../../lib/errors.js';
import { clip, defineTool, fail, ok } from '../define.js';
import type { Tool } from '../types.js';

const pathField = z.string().min(1).max(1024).describe('Path relative to the project root (/workspace).');

export function fsTools(sandbox: SandboxManager): Tool[] {
  const wrap = async <T>(fn: () => Promise<T>): Promise<T | { error: string }> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AppError) return { error: err.message };
      throw err;
    }
  };

  return [
    defineTool({
      name: 'fs_list',
      description:
        'List files and directories in the project (node_modules, .git and virtualenvs are skipped).',
      permission: 'read',
      schema: z.object({
        prefix: z.string().max(1024).optional().describe('Only list entries under this directory.'),
      }),
      async run(ctx, args) {
        const entries = await sandbox.listFiles(ctx.projectId);
        const prefix = args.prefix?.replace(/^\/?(workspace\/)?/, '').replace(/\/$/, '');
        const filtered = prefix
          ? entries.filter((e) => e.path === prefix || e.path.startsWith(`${prefix}/`))
          : entries;
        if (filtered.length === 0) return ok('(no files)');
        return ok(
          clip(filtered.map((e) => (e.type === 'dir' ? `${e.path}/` : `${e.path} (${e.size} B)`)).join('\n')),
        );
      },
    }),
    defineTool({
      name: 'fs_read',
      description: 'Read a UTF-8 text file from the project.',
      permission: 'read',
      schema: z.object({ path: pathField }),
      async run(ctx, args) {
        const r = await wrap(() => sandbox.readFile(ctx.projectId, args.path));
        if ('error' in r) return fail(r.error);
        if (r.binary) return fail(`${r.path} is a binary file (${r.size} bytes).`);
        return ok(clip(r.content, 60_000) + (r.truncated ? '\n[file truncated]' : ''));
      },
    }),
    defineTool({
      name: 'fs_write',
      description: 'Create or overwrite a file with the given full content. Parent directories are created.',
      permission: 'write',
      schema: z.object({ path: pathField, content: z.string().max(2_000_000) }),
      async run(ctx, args) {
        const r = await wrap(() =>
          sandbox.writeFile(ctx.projectId, args.path, args.content, ctx.actorUserId),
        );
        if ('error' in r) return fail(r.error);
        return ok(`Wrote ${r.path} (${r.bytes} bytes).`);
      },
    }),
    defineTool({
      name: 'fs_patch',
      description:
        'Edit a file by replacing an exact snippet. `old_text` must occur exactly once unless `replace_all` is true. Use for small edits instead of rewriting the file.',
      permission: 'write',
      schema: z.object({
        path: pathField,
        old_text: z.string().min(1),
        new_text: z.string(),
        replace_all: z.boolean().optional(),
      }),
      async run(ctx, args) {
        const r = await wrap(() => sandbox.readFile(ctx.projectId, args.path));
        if ('error' in r) return fail(r.error);
        if (r.binary || r.truncated) return fail('File is binary or too large to patch.');
        const count = r.content.split(args.old_text).length - 1;
        if (count === 0) return fail('old_text was not found in the file.');
        if (count > 1 && !args.replace_all)
          return fail(`old_text occurs ${count} times; make it unique or set replace_all.`);
        const updated = args.replace_all
          ? r.content.split(args.old_text).join(args.new_text)
          : r.content.replace(args.old_text, () => args.new_text);
        const w = await wrap(() => sandbox.writeFile(ctx.projectId, args.path, updated, ctx.actorUserId));
        if ('error' in w) return fail(w.error);
        return ok(`Patched ${w.path} (${count} replacement${count === 1 ? '' : 's'}).`);
      },
    }),
    defineTool({
      name: 'fs_delete',
      description: 'Delete a file or directory (recursively) in the project.',
      permission: 'write',
      schema: z.object({ path: pathField }),
      async run(ctx, args) {
        const r = await wrap(() => sandbox.deleteFile(ctx.projectId, args.path));
        if (r && typeof r === 'object' && 'error' in r) return fail(r.error);
        return ok(`Deleted ${args.path}.`);
      },
    }),
  ];
}
