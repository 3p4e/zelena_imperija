import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { addPreviewPortSchema, execRequestSchema, writeFileSchema, type SandboxInfo } from '@agent/shared';
import type { AppDeps } from '../../deps.js';
import { executionLogs, executions, previewPorts, sandboxes, testRuns } from '../../db/schema/index.js';
import { currentUser } from '../../auth/plugin.js';
import { AppError, notFound } from '../../lib/errors.js';
import { openSse } from '../../lib/sse.js';
import { parseBody, requireUuid } from '../../lib/validate.js';
import { signPreviewToken } from '../../sandbox/preview-token.js';
import { iso } from '../dto.js';
import { runTestCommand } from '../../tools/builtin/shell.js';
import { projectFor } from '../projects/access.js';

const pathQuery = z.object({ path: z.string().min(1).max(1024) });
const portQuery = z.object({ port: z.coerce.number().int().min(1).max(65535) });

export function registerSandboxRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, sandbox } = deps;
  const pid = (req: { params: unknown }): string => (req.params as { id: string }).id;

  const info = async (projectId: string): Promise<SandboxInfo | null> => {
    const row = await sandbox.info(projectId);
    if (!row) return null;
    return {
      id: row.id,
      projectId,
      status: row.status,
      cpu: row.cpu,
      memMb: row.memMb,
      diskMb: row.diskMb,
      startedAt: iso(row.startedAt),
      stoppedAt: iso(row.stoppedAt),
      previewPorts: await sandbox.previewPortsFor(row.id),
    };
  };

  app.get('/projects/:id/sandbox', async (req) => {
    const { project } = await projectFor(db, currentUser(req), pid(req), 'read');
    return { sandbox: await info(project.id) };
  });

  app.post('/projects/:id/sandbox/start', async (req) => {
    const { project } = await projectFor(db, currentUser(req), pid(req), 'edit');
    await sandbox.ensureRunning(project.id);
    return { sandbox: await info(project.id) };
  });

  app.post('/projects/:id/sandbox/stop', async (req) => {
    const { project } = await projectFor(db, currentUser(req), pid(req), 'edit');
    await sandbox.stop(project.id);
    return { sandbox: await info(project.id) };
  });

  app.get('/projects/:id/files', async (req) => {
    const { project } = await projectFor(db, currentUser(req), pid(req), 'read');
    return { entries: await sandbox.listFiles(project.id) };
  });

  app.get('/projects/:id/files/content', async (req) => {
    const { project } = await projectFor(db, currentUser(req), pid(req), 'read');
    const q = parseBody(pathQuery, req.query);
    return sandbox.readFile(project.id, q.path);
  });

  app.put('/projects/:id/files/content', async (req) => {
    const user = currentUser(req);
    const { project } = await projectFor(db, user, pid(req), 'edit');
    const body = parseBody(writeFileSchema, req.body);
    return sandbox.writeFile(project.id, body.path, body.content, user.id);
  });

  app.delete('/projects/:id/files/content', async (req) => {
    const { project } = await projectFor(db, currentUser(req), pid(req), 'edit');
    const q = parseBody(pathQuery, req.query);
    await sandbox.deleteFile(project.id, q.path);
    return { ok: true };
  });

  /** Runs a command from the UI and streams its output as SSE. */
  app.post('/projects/:id/exec', async (req, reply) => {
    const user = currentUser(req);
    const { project } = await projectFor(db, user, pid(req), 'edit');
    const body = parseBody(execRequestSchema, req.body);
    await sandbox.ensureRunning(project.id);
    const sse = openSse(req, reply);
    const controller = new AbortController();
    sse.onClose(() => controller.abort());
    try {
      const r = await sandbox.exec({
        projectId: project.id,
        command: body.command,
        ...(body.timeoutS ? { timeoutS: body.timeoutS } : {}),
        kind: 'shell',
        actorUserId: user.id,
        signal: controller.signal,
        onOutput: (stream, chunk) => sse.send({ type: stream, chunk }),
      });
      sse.send({ type: 'exit', exitCode: r.exitCode, timedOut: r.timedOut, executionId: r.executionId });
    } catch (err) {
      sse.send({ type: 'stderr', chunk: err instanceof AppError ? err.message : 'Execution failed.' });
      sse.send({ type: 'exit', exitCode: null, timedOut: false });
    }
    sse.close();
  });

  app.get('/projects/:id/executions', async (req) => {
    const { project } = await projectFor(db, currentUser(req), pid(req), 'read');
    const row = await sandbox.info(project.id);
    if (!row) return [];
    const list = await db
      .select()
      .from(executions)
      .where(and(eq(executions.sandboxId, row.id), inArray(executions.kind, ['shell', 'test', 'preview', 'git'])))
      .orderBy(desc(executions.startedAt))
      .limit(100);
    return list.map((e) => ({
      id: e.id,
      kind: e.kind,
      command: e.command,
      exitCode: e.exitCode,
      startedAt: e.startedAt.toISOString(),
      finishedAt: iso(e.finishedAt),
      timedOut: e.timedOut,
      actorUserId: e.actorUserId,
    }));
  });

  app.get('/executions/:id/logs', async (req) => {
    const user = currentUser(req);
    const id = requireUuid((req.params as { id: string }).id);
    const e = await db.select({ projectId: sandboxes.projectId }).from(executions).innerJoin(sandboxes, eq(sandboxes.id, executions.sandboxId)).where(eq(executions.id, id)).limit(1);
    if (!e[0]) throw notFound('Execution');
    await projectFor(db, user, e[0].projectId, 'read').catch(() => {
      throw notFound('Execution');
    });
    const logs = await db.select().from(executionLogs).where(eq(executionLogs.executionId, id)).orderBy(executionLogs.seq);
    return logs.map((l) => ({ stream: l.stream, chunk: l.chunk }));
  });

  app.get('/projects/:id/test-runs', async (req) => {
    const { project } = await projectFor(db, currentUser(req), pid(req), 'read');
    const row = await sandbox.info(project.id);
    if (!row) return [];
    const list = await db
      .select({
        id: testRuns.id,
        executionId: testRuns.executionId,
        framework: testRuns.framework,
        total: testRuns.total,
        passed: testRuns.passed,
        failed: testRuns.failed,
        summary: testRuns.summary,
        createdAt: testRuns.createdAt,
        command: executions.command,
      })
      .from(testRuns)
      .innerJoin(executions, eq(executions.id, testRuns.executionId))
      .where(eq(executions.sandboxId, row.id))
      .orderBy(desc(testRuns.createdAt))
      .limit(50);
    return list.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }));
  });

  /** Runs a test command from the Tests panel; streams output and records a structured result. */
  app.post('/projects/:id/test-runs', async (req, reply) => {
    const user = currentUser(req);
    const { project } = await projectFor(db, user, pid(req), 'edit');
    const body = parseBody(execRequestSchema, req.body);
    await sandbox.ensureRunning(project.id);
    const sse = openSse(req, reply);
    const controller = new AbortController();
    sse.onClose(() => controller.abort());
    try {
      const { exec, summary } = await runTestCommand(sandbox, db, {
        projectId: project.id,
        command: body.command,
        timeoutS: body.timeoutS,
        actorUserId: user.id,
        signal: controller.signal,
        onOutput: (chunk) => sse.send({ type: 'stdout', chunk }),
      });
      sse.send({ type: 'stdout', chunk: `\n${summary.text}\n` });
      sse.send({ type: 'exit', exitCode: exec.exitCode, timedOut: exec.timedOut, executionId: exec.executionId });
    } catch (err) {
      sse.send({ type: 'stderr', chunk: err instanceof AppError ? err.message : 'Test run failed.' });
      sse.send({ type: 'exit', exitCode: null, timedOut: false });
    }
    sse.close();
  });

  app.post('/projects/:id/preview-ports', async (req) => {
    const { project } = await projectFor(db, currentUser(req), pid(req), 'edit');
    const body = parseBody(addPreviewPortSchema, req.body);
    await sandbox.ensureRunning(project.id);
    const row = await sandbox.info(project.id);
    if (!row) throw new AppError('sandbox_unavailable', 'Sandbox missing.');
    await db
      .insert(previewPorts)
      .values({ sandboxId: row.id, port: body.port, label: body.label })
      .onConflictDoUpdate({ target: [previewPorts.sandboxId, previewPorts.port], set: { label: body.label } });
    return { sandbox: await info(project.id) };
  });

  app.delete('/projects/:id/preview-ports/:port', async (req) => {
    const { project } = await projectFor(db, currentUser(req), pid(req), 'edit');
    const port = Number((req.params as { port: string }).port);
    const row = await sandbox.info(project.id);
    if (row) await db.delete(previewPorts).where(and(eq(previewPorts.sandboxId, row.id), eq(previewPorts.port, port)));
    return { ok: true };
  });

  app.get('/projects/:id/preview-url', async (req) => {
    const user = currentUser(req);
    const { project } = await projectFor(db, user, pid(req), 'read');
    const q = parseBody(portQuery, req.query);
    const row = await sandbox.info(project.id);
    const ports = row ? await sandbox.previewPortsFor(row.id) : [];
    if (!ports.some((p) => p.port === q.port)) throw new AppError('not_found', `Port ${q.port} is not registered for preview.`);
    const exp = Math.floor(Date.now() / 1000) + deps.config.PREVIEW_TOKEN_TTL_HOURS * 3600;
    const token = signPreviewToken(deps.vault, { projectId: project.id, port: q.port, userId: user.id, exp });
    return { url: `/preview/${token}/`, expiresAt: new Date(exp * 1000).toISOString() };
  });

  /** Interactive terminal over WebSocket. Client sends JSON {type:'input',data} | {type:'resize',cols,rows}. */
  app.get('/projects/:id/terminal', { websocket: true }, async (socket, req) => {
    const user = currentUser(req);
    let access;
    try {
      access = await projectFor(db, user, pid(req), 'edit');
    } catch {
      socket.close(4403, 'forbidden');
      return;
    }
    let term;
    try {
      term = await sandbox.openTerminal(access.project.id, user.id);
    } catch (err) {
      socket.send(`\r\n[terminal unavailable: ${err instanceof AppError ? err.message : 'error'}]\r\n`);
      socket.close(1011, 'unavailable');
      return;
    }
    term.stream.on('data', (b: Buffer) => socket.send(b.toString('utf8')));
    term.stream.on('end', () => socket.close(1000, 'exit'));
    socket.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString('utf8')) as { type: string; data?: string; cols?: number; rows?: number };
        if (msg.type === 'input' && typeof msg.data === 'string') term.stream.write(msg.data);
        else if (msg.type === 'resize' && msg.cols && msg.rows) void term.resize(Math.min(msg.cols, 500), Math.min(msg.rows, 200)).catch(() => undefined);
      } catch {
        /* ignore malformed frames */
      }
    });
    socket.on('close', () => term.stream.end());
  });
}
