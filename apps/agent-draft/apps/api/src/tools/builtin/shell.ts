import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { testRuns } from '../../db/schema/index.js';
import type { SandboxManager, ExecResult } from '../../sandbox/manager.js';
import { clip, defineTool, fail, ok } from '../define.js';
import type { Tool } from '../types.js';
import { parseTestSummary, type TestSummary } from './test-parse.js';

function formatExec(r: ExecResult): string {
  const parts: string[] = [];
  if (r.stdout) parts.push(r.stdout);
  if (r.stderr) parts.push(`[stderr]\n${r.stderr}`);
  if (r.timedOut) parts.push('[command timed out and was killed]');
  else if (r.aborted) parts.push('[command cancelled]');
  else parts.push(`[exit code ${r.exitCode ?? 'unknown'}]`);
  return clip(parts.join('\n'));
}

export function shellTools(sandbox: SandboxManager, db: Db): Tool[] {
  return [
    defineTool({
      name: 'shell_exec',
      description:
        'Run a non-interactive bash command in /workspace and return its output. For long-running servers set background=true (output goes to a log file) and then call preview_register.',
      permission: 'exec',
      schema: z.object({
        command: z.string().min(1).max(10_000),
        timeout_s: z
          .number()
          .int()
          .min(1)
          .max(3600)
          .optional()
          .describe('Kill the command after this many seconds.'),
        background: z.boolean().optional(),
      }),
      async run(ctx, args) {
        if (args.background) {
          const log = await sandbox.startBackground(
            ctx.projectId,
            args.command,
            `bg-${Date.now()}`,
            ctx.actorUserId,
          );
          return ok(`Started in background. Output is written to ${log}; read it with: tail -n 50 ${log}`);
        }
        const r = await sandbox.exec({
          projectId: ctx.projectId,
          command: args.command,
          ...(args.timeout_s ? { timeoutS: args.timeout_s } : {}),
          kind: 'shell',
          actorUserId: ctx.actorUserId,
          conversationId: ctx.conversationId,
          messagePartId: ctx.messagePartId,
          signal: ctx.signal,
          onOutput: (_s, chunk) => ctx.onProgress?.(chunk),
        });
        const text = formatExec(r);
        return r.exitCode === 0 ? ok(text) : fail(text);
      },
    }),
    defineTool({
      name: 'test_run',
      description:
        'Run the project test command (e.g. "npm test", "pytest -q") and record a structured result shown in the Tests panel.',
      permission: 'exec',
      schema: z.object({
        command: z.string().min(1).max(2000),
        timeout_s: z.number().int().min(1).max(3600).optional(),
      }),
      async run(ctx, args) {
        const { exec, summary } = await runTestCommand(sandbox, db, {
          projectId: ctx.projectId,
          command: args.command,
          timeoutS: args.timeout_s,
          actorUserId: ctx.actorUserId,
          conversationId: ctx.conversationId,
          messagePartId: ctx.messagePartId,
          signal: ctx.signal,
          onOutput: (chunk) => ctx.onProgress?.(chunk),
        });
        const text = `${summary.text}\n\n${formatExec(exec)}`;
        return exec.exitCode === 0 ? ok(text) : fail(text);
      },
    }),
  ];
}

/** Runs a test command in the sandbox and records a structured test run. Shared by the agent tool and the Tests panel. */
export async function runTestCommand(
  sandbox: SandboxManager,
  db: Db,
  p: {
    projectId: string;
    command: string;
    timeoutS?: number | undefined;
    actorUserId: string;
    conversationId?: string | null;
    messagePartId?: string | null;
    signal?: AbortSignal | undefined;
    onOutput?: (chunk: string) => void;
  },
): Promise<{ exec: ExecResult; summary: TestSummary }> {
  const exec = await sandbox.exec({
    projectId: p.projectId,
    command: p.command,
    ...(p.timeoutS ? { timeoutS: p.timeoutS } : {}),
    kind: 'test',
    actorUserId: p.actorUserId,
    conversationId: p.conversationId ?? null,
    messagePartId: p.messagePartId ?? null,
    signal: p.signal,
    onOutput: (_s, chunk) => p.onOutput?.(chunk),
  });
  const summary = parseTestSummary(`${exec.stdout}\n${exec.stderr}`, exec.exitCode);
  if (exec.executionId) {
    await db.insert(testRuns).values({
      executionId: exec.executionId,
      framework: summary.framework,
      total: summary.total,
      passed: summary.passed,
      failed: summary.failed,
      summary: summary.text,
    });
  }
  return { exec, summary };
}
