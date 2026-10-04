import { and, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import type Docker from 'dockerode';
import type { Duplex } from 'node:stream';
import type { Logger } from 'pino';
import type { ExecutionKind } from '@agent/shared';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/client.js';
import { executionLogs, executions, globalSettings, memberLimits, previewPorts, projects, sandboxes, users } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import { dockerExec, isNotFound } from './docker.js';
import { WORKSPACE, relativeToWorkspace, workspacePath } from './paths.js';

export const SANDBOX_UID = '1000:1000';
const SUBNET_POOL_PREFIX = '10.89';
const MAX_FILE_READ_BYTES = 2 * 1024 * 1024;
const MAX_LOG_BYTES_PER_EXEC = 5 * 1024 * 1024;

export interface Limits {
  cpu: number;
  memMb: number;
  diskMb: number;
  maxContainers: number;
  networkMode: 'egress' | 'none';
}

export interface ExecRequest {
  projectId: string;
  /** Either a shell command (run under bash -lc) or an argv vector (no shell). */
  command?: string;
  argv?: string[];
  stdin?: string;
  timeoutS?: number;
  kind: ExecutionKind;
  actorUserId: string | null;
  conversationId?: string | null;
  messagePartId?: string | null;
  signal?: AbortSignal | undefined;
  onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void;
  /** Internal file operations are not written to the execution log. */
  log?: boolean;
}

export interface ExecResult {
  executionId: string | null;
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
}

export interface FileListEntry {
  path: string;
  type: 'file' | 'dir';
  size: number;
}

/**
 * One container per project, owned by the project owner.
 *
 * Isolation:
 * - per-user bridge network on a dedicated subnet; Docker isolates bridges from each other,
 *   and infra/host/sandbox-firewall.sh drops sandbox traffic to the host and private ranges;
 * - no host bind mounts; a named volume holds /workspace; root fs read-only;
 * - all capabilities dropped, no-new-privileges, pids/cpu/memory limits, non-root user;
 * - every command runs under `timeout` with a server-side hard deadline as backstop.
 */
export class SandboxManager {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly diskCache = new Map<string, { mb: number; at: number }>();

  constructor(
    private readonly db: Db,
    private readonly docker: Docker,
    private readonly config: AppConfig,
    private readonly log: Logger,
  ) {}

  private names(projectId: string, ownerUserId: string): { container: string; volume: string; network: string } {
    const p = this.config.SANDBOX_PREFIX;
    return { container: `${p}-${projectId}`, volume: `${p}-vol-${projectId}`, network: `${p}-net-${ownerUserId}` };
  }

  /** Serialises lifecycle operations per project. */
  private async withLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(projectId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(
      projectId,
      next.catch(() => undefined),
    );
    return next;
  }

  async limitsFor(userId: string): Promise<Limits> {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    const s = await this.db.query.globalSettings.findFirst({ where: eq(globalSettings.id, 1) });
    if (!user || !s) throw new AppError('internal', 'Settings missing.');
    if (user.role === 'admin') {
      return {
        cpu: s.adminSandboxCpu,
        memMb: s.adminSandboxMemMb,
        diskMb: s.adminSandboxDiskMb,
        maxContainers: s.adminMaxContainers,
        networkMode: 'egress',
      };
    }
    const m = await this.db.query.memberLimits.findFirst({ where: eq(memberLimits.userId, userId) });
    return {
      cpu: m?.sandboxCpu ?? s.memberSandboxCpu,
      memMb: m?.sandboxMemMb ?? s.memberSandboxMemMb,
      diskMb: m?.sandboxDiskMb ?? s.memberSandboxDiskMb,
      maxContainers: m?.maxContainers ?? s.memberMaxContainers,
      networkMode: m?.networkMode ?? 'egress',
    };
  }

  private async commandTimeoutS(): Promise<number> {
    const s = await this.db.query.globalSettings.findFirst({ where: eq(globalSettings.id, 1) });
    return s?.commandTimeoutS ?? 300;
  }

  async info(projectId: string): Promise<typeof sandboxes.$inferSelect | null> {
    return (await this.db.query.sandboxes.findFirst({ where: eq(sandboxes.projectId, projectId) })) ?? null;
  }

  async previewPortsFor(sandboxId: string): Promise<{ port: number; label: string }[]> {
    return this.db.select({ port: previewPorts.port, label: previewPorts.label }).from(previewPorts).where(eq(previewPorts.sandboxId, sandboxId));
  }

  /** Returns a running container for the project, creating network/volume/container as needed. */
  async ensureRunning(projectId: string): Promise<Docker.Container> {
    return this.withLock(projectId, async () => {
      const project = await this.db.query.projects.findFirst({ where: eq(projects.id, projectId) });
      if (!project) throw new AppError('not_found', 'Project not found.');
      const names = this.names(projectId, project.ownerUserId);
      const limits = await this.limitsFor(project.ownerUserId);
      let row = await this.info(projectId);

      if (row?.containerId && row.status === 'running') {
        const c = this.docker.getContainer(row.containerId);
        try {
          const inspect = await c.inspect();
          if (inspect.State.Running) {
            await this.touch(projectId);
            return c;
          }
        } catch (err) {
          if (!isNotFound(err)) throw err;
        }
      }

      await this.enforceContainerCap(project.ownerUserId, projectId, limits.maxContainers);

      if (!row) {
        const [created] = await this.db
          .insert(sandboxes)
          .values({ projectId, volumeName: names.volume, status: 'creating', cpu: limits.cpu, memMb: limits.memMb, diskMb: limits.diskMb })
          .returning();
        if (!created) throw new AppError('sandbox_unavailable', 'Could not register the sandbox.');
        row = created;
      }

      try {
        await this.ensureVolume(names.volume, projectId, project.ownerUserId);
        const networkName = limits.networkMode === 'none' ? null : await this.ensureUserNetwork(names.network, project.ownerUserId);
        let container = await this.findContainer(names.container);
        const needsRecreate =
          container !== null &&
          (row.cpu !== limits.cpu || row.memMb !== limits.memMb || (await this.networkOf(container)) !== (networkName ?? 'none'));
        if (container && needsRecreate) {
          await container.remove({ force: true });
          container = null;
        }
        container ??= await this.docker.createContainer({
            name: names.container,
            Image: project.sandboxImage,
            User: SANDBOX_UID,
            WorkingDir: WORKSPACE,
            Cmd: ['sleep', 'infinity'],
            Env: ['HOME=/home/sandbox', 'CI=1', 'TERM=xterm-256color', 'NPM_CONFIG_UPDATE_NOTIFIER=false'],
            Labels: { 'agent.managed': '1', 'agent.project': projectId, 'agent.owner': project.ownerUserId },
            HostConfig: {
              Mounts: [{ Type: 'volume', Source: names.volume, Target: WORKSPACE }],
              Tmpfs: {
                '/tmp': 'rw,nosuid,nodev,exec,size=512m',
                '/home/sandbox': 'rw,nosuid,nodev,exec,size=512m,uid=1000,gid=1000',
              },
              ReadonlyRootfs: true,
              CapDrop: ['ALL'],
              SecurityOpt: ['no-new-privileges'],
              Memory: limits.memMb * 1024 * 1024,
              MemorySwap: limits.memMb * 1024 * 1024,
              NanoCpus: Math.round(limits.cpu * 1e9),
              PidsLimit: 512,
              NetworkMode: networkName ?? 'none',
              Runtime: this.config.SANDBOX_RUNTIME,
              Init: true,
              Privileged: false,
              RestartPolicy: { Name: 'no' },
            },
          });
        const inspect = await container.inspect();
        if (!inspect.State.Running) await container.start();
        await this.db
          .update(sandboxes)
          .set({
            containerId: container.id,
            networkId: networkName,
            status: 'running',
            cpu: limits.cpu,
            memMb: limits.memMb,
            diskMb: limits.diskMb,
            startedAt: new Date(),
            stoppedAt: null,
            lastActivityAt: new Date(),
          })
          .where(eq(sandboxes.id, row.id));
        await this.initWorkspace(container);
        return container;
      } catch (err) {
        await this.db.update(sandboxes).set({ status: 'failed' }).where(eq(sandboxes.id, row.id));
        if (err instanceof AppError) throw err;
        this.log.error({ projectId, err: errMessage(err) }, 'sandbox start failed');
        throw new AppError('sandbox_unavailable', `The sandbox could not be started: ${errMessage(err)}`, undefined, true);
      }
    });
  }

  private async initWorkspace(container: Docker.Container): Promise<void> {
    await dockerExec(container, {
      cmd: [
        'sh',
        '-c',
        'test -d .git || (git init -q && git config user.email agent@sandbox.local && git config user.name "Agent")',
      ],
      deadlineMs: 20_000,
    });
  }

  private async enforceContainerCap(ownerUserId: string, projectId: string, max: number): Promise<void> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(sandboxes)
      .innerJoin(projects, eq(projects.id, sandboxes.projectId))
      .where(and(eq(projects.ownerUserId, ownerUserId), eq(sandboxes.status, 'running'), ne(sandboxes.projectId, projectId)));
    if ((row?.n ?? 0) >= max) {
      throw new AppError(
        'sandbox_limit_reached',
        `You already have ${row?.n ?? 0} running sandbox(es); the limit is ${max}. Stop another project's sandbox first.`,
      );
    }
  }

  private async findContainer(name: string): Promise<Docker.Container | null> {
    const c = this.docker.getContainer(name);
    try {
      await c.inspect();
      return c;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  private async networkOf(container: Docker.Container): Promise<string> {
    const i = await container.inspect();
    return i.HostConfig.NetworkMode ?? 'default';
  }

  private async ensureVolume(name: string, projectId: string, ownerUserId: string): Promise<void> {
    try {
      await this.docker.getVolume(name).inspect();
    } catch (err) {
      if (!isNotFound(err)) throw err;
      await this.docker.createVolume({ Name: name, Labels: { 'agent.managed': '1', 'agent.project': projectId, 'agent.owner': ownerUserId } });
    }
  }

  /** One bridge per user on its own /24 from 10.89.0.0/16. */
  private async ensureUserNetwork(name: string, ownerUserId: string): Promise<string> {
    const existing = await this.docker.listNetworks({ filters: { name: [name] } });
    if (existing.some((n) => n.Name === name)) return name;
    const managed = await this.docker.listNetworks({ filters: { label: ['agent.managed=1'] } });
    const used = new Set<number>();
    for (const n of managed) {
      for (const cfg of n.IPAM?.Config ?? []) {
        const m = /^10\.89\.(\d+)\.0\/24$/.exec(cfg.Subnet ?? '');
        if (m?.[1]) used.add(Number(m[1]));
      }
    }
    let octet = -1;
    for (let i = 1; i < 255; i++) {
      if (!used.has(i)) {
        octet = i;
        break;
      }
    }
    if (octet < 0) throw new AppError('sandbox_unavailable', 'No free sandbox subnets left.');
    const subnet = `${SUBNET_POOL_PREFIX}.${octet}.0/24`;
    await this.docker.createNetwork({
      Name: name,
      Driver: 'bridge',
      CheckDuplicate: true,
      Labels: { 'agent.managed': '1', 'agent.owner': ownerUserId },
      Options: { 'com.docker.network.bridge.enable_icc': 'true' },
      IPAM: { Driver: 'default', Config: [{ Subnet: subnet, Gateway: `${SUBNET_POOL_PREFIX}.${octet}.1` }] },
    });
    if (this.config.SANDBOX_API_CONTAINER) {
      // The API joins each user network at .254 so it can reach preview ports. The host firewall
      // script allows only that address to open connections inside the sandbox subnets.
      await this.docker.getNetwork(name).connect({
        Container: this.config.SANDBOX_API_CONTAINER,
        EndpointConfig: { IPAMConfig: { IPv4Address: `${SUBNET_POOL_PREFIX}.${octet}.254` } },
      });
    }
    return name;
  }

  async stop(projectId: string): Promise<void> {
    await this.withLock(projectId, async () => {
      const row = await this.info(projectId);
      if (!row?.containerId) return;
      try {
        await this.docker.getContainer(row.containerId).stop({ t: 2 });
      } catch (err) {
        if (!isNotFound(err) && !errMessage(err).includes('not running')) throw err;
      }
      await this.db.update(sandboxes).set({ status: 'stopped', stoppedAt: new Date() }).where(eq(sandboxes.id, row.id));
    });
  }

  /** Removes container and volume (project deletion). */
  async destroy(projectId: string): Promise<void> {
    await this.withLock(projectId, async () => {
      const row = await this.info(projectId);
      const project = await this.db.query.projects.findFirst({ where: eq(projects.id, projectId) });
      const names = this.names(projectId, project?.ownerUserId ?? 'unknown');
      const container = await this.findContainer(row?.containerId ?? names.container);
      if (container) await container.remove({ force: true });
      try {
        await this.docker.getVolume(row?.volumeName ?? names.volume).remove({ force: true });
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
      if (row) await this.db.update(sandboxes).set({ status: 'removed', containerId: null }).where(eq(sandboxes.id, row.id));
    });
  }

  async containerIp(projectId: string): Promise<string> {
    const container = await this.ensureRunning(projectId);
    const i = await container.inspect();
    const nets = Object.values(i.NetworkSettings.Networks);
    const ip = nets[0]?.IPAddress;
    if (!ip) throw new AppError('sandbox_unavailable', 'The sandbox has no network (network mode "none").');
    return ip;
  }

  private async touch(projectId: string): Promise<void> {
    await this.db.update(sandboxes).set({ lastActivityAt: new Date() }).where(eq(sandboxes.projectId, projectId));
  }

  private async diskUsageMb(container: Docker.Container, projectId: string): Promise<number> {
    const cached = this.diskCache.get(projectId);
    if (cached && Date.now() - cached.at < 30_000) return cached.mb;
    const r = await dockerExec(container, { cmd: ['du', '-sm', WORKSPACE], deadlineMs: 30_000 });
    const mb = Number(/^(\d+)/.exec(r.stdout)?.[1] ?? 0);
    this.diskCache.set(projectId, { mb, at: Date.now() });
    return mb;
  }

  private async checkDisk(container: Docker.Container, projectId: string): Promise<void> {
    const row = await this.info(projectId);
    if (!row) return;
    const used = await this.diskUsageMb(container, projectId);
    if (used >= row.diskMb) {
      throw new AppError('sandbox_limit_reached', `The project uses ${used} MB, above its ${row.diskMb} MB disk limit. Delete files to continue.`);
    }
  }

  /** Runs a command; logs it to `executions` / `execution_logs` unless `log: false`. */
  async exec(req: ExecRequest): Promise<ExecResult> {
    const container = await this.ensureRunning(req.projectId);
    if (req.kind !== 'fs') await this.checkDisk(container, req.projectId);
    const row = await this.info(req.projectId);
    if (!row) throw new AppError('sandbox_unavailable', 'Sandbox missing.');
    const timeoutS = Math.max(1, Math.min(req.timeoutS ?? (await this.commandTimeoutS()), 3600));
    const base = req.argv ?? ['bash', '-lc', req.command ?? 'true'];
    const cmd = ['timeout', '-k', '2', `${timeoutS}`, ...base];
    const shouldLog = req.log ?? true;

    let executionId: string | null = null;
    if (shouldLog) {
      const [e] = await this.db
        .insert(executions)
        .values({
          sandboxId: row.id,
          conversationId: req.conversationId ?? null,
          messagePartId: req.messagePartId ?? null,
          actorUserId: req.actorUserId,
          kind: req.kind,
          command: req.command ?? base.join(' '),
        })
        .returning({ id: executions.id });
      executionId = e?.id ?? null;
    }

    const logger = executionId ? new ExecLogWriter(this.db, executionId) : null;
    const started = Date.now();
    const outcome = await dockerExec(container, {
      cmd,
      ...(req.stdin !== undefined ? { stdin: req.stdin } : {}),
      deadlineMs: (timeoutS + 15) * 1000,
      signal: req.signal,
      onStdout: (c) => {
        logger?.push('stdout', c);
        req.onOutput?.('stdout', c);
      },
      onStderr: (c) => {
        logger?.push('stderr', c);
        req.onOutput?.('stderr', c);
      },
    });
    const durationMs = Date.now() - started;
    if (outcome.deadlineHit || outcome.aborted) {
      // Backstop: kill everything the sandbox user is running for this command tree.
      await dockerExec(container, { cmd: ['sh', '-c', 'pkill -KILL -f "^timeout -k 2" || true'], deadlineMs: 10_000 }).catch(() => undefined);
    }
    const timedOut = outcome.deadlineHit || ((outcome.exitCode === 124 || outcome.exitCode === 137) && durationMs >= timeoutS * 1000 - 250);
    await logger?.flush();
    if (executionId) {
      await this.db
        .update(executions)
        .set({
          exitCode: outcome.exitCode,
          finishedAt: new Date(),
          timedOut,
          stdoutBytes: outcome.stdoutBytes,
          stderrBytes: outcome.stderrBytes,
        })
        .where(eq(executions.id, executionId));
    }
    await this.touch(req.projectId);
    if (req.kind !== 'fs') this.diskCache.delete(req.projectId);
    return {
      executionId,
      exitCode: outcome.exitCode,
      timedOut,
      aborted: outcome.aborted,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      truncated: outcome.truncated,
      durationMs,
    };
  }

  /** Starts a long-running process (dev server) detached, output to a log file in /tmp. */
  async startBackground(projectId: string, command: string, logName: string, actorUserId: string | null): Promise<string> {
    const container = await this.ensureRunning(projectId);
    await this.checkDisk(container, projectId);
    const row = await this.info(projectId);
    const logPath = `/tmp/${logName.replace(/[^a-zA-Z0-9_.-]/g, '_')}.log`;
    const exec = await container.exec({
      Cmd: ['bash', '-lc', `nohup bash -lc ${shellQuote(command)} > ${logPath} 2>&1 &`],
      User: SANDBOX_UID,
      WorkingDir: WORKSPACE,
      AttachStdout: false,
      AttachStderr: false,
    });
    await exec.start({ Detach: true });
    if (row) {
      await this.db.insert(executions).values({
        sandboxId: row.id,
        actorUserId,
        kind: 'preview',
        command: `[background] ${command}`,
        exitCode: null,
        finishedAt: new Date(),
      });
    }
    return logPath;
  }

  async listFiles(projectId: string, maxEntries = 5000): Promise<FileListEntry[]> {
    const r = await this.exec({
      projectId,
      kind: 'fs',
      actorUserId: null,
      log: false,
      timeoutS: 30,
      argv: [
        'find',
        WORKSPACE,
        '-mindepth',
        '1',
        '(',
        '-name',
        'node_modules',
        '-o',
        '-name',
        '.git',
        '-o',
        '-name',
        '.venv',
        '-o',
        '-name',
        '__pycache__',
        ')',
        '-prune',
        '-o',
        '-printf',
        '%y\t%s\t%P\n',
      ],
    });
    const entries: FileListEntry[] = [];
    for (const line of r.stdout.split('\n')) {
      if (!line) continue;
      const [t, size, p] = line.split('\t');
      if (!p || (t !== 'f' && t !== 'd')) continue;
      entries.push({ path: p, type: t === 'd' ? 'dir' : 'file', size: Number(size) });
      if (entries.length >= maxEntries) break;
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return entries;
  }

  async readFile(projectId: string, rel: string): Promise<{ path: string; content: string; size: number; binary: boolean; truncated: boolean }> {
    const abs = workspacePath(rel);
    const stat = await this.exec({ projectId, kind: 'fs', actorUserId: null, log: false, timeoutS: 10, argv: ['stat', '-c', '%s %F', '--', abs] });
    if (stat.exitCode !== 0) throw new AppError('not_found', `File not found: ${relativeToWorkspace(abs)}`);
    const [sizeStr, ...typeParts] = stat.stdout.trim().split(' ');
    if (!typeParts.join(' ').includes('regular')) throw new AppError('validation_failed', 'Not a regular file.');
    const size = Number(sizeStr);
    const r = await this.exec({
      projectId,
      kind: 'fs',
      actorUserId: null,
      log: false,
      timeoutS: 30,
      argv: ['head', '-c', `${MAX_FILE_READ_BYTES}`, '--', abs],
    });
    const binary = r.stdout.slice(0, 8000).includes('\u0000');
    return { path: relativeToWorkspace(abs), content: binary ? '' : r.stdout, size, binary, truncated: size > MAX_FILE_READ_BYTES };
  }

  async writeFile(projectId: string, rel: string, content: string, actorUserId: string | null): Promise<{ path: string; bytes: number }> {
    const abs = workspacePath(rel);
    const container = await this.ensureRunning(projectId);
    await this.checkDisk(container, projectId);
    const r = await this.exec({
      projectId,
      kind: 'fs',
      actorUserId,
      log: false,
      timeoutS: 30,
      argv: ['sh', '-c', 'mkdir -p -- "$(dirname -- "$1")" && cat > "$1"', 'sh', abs],
      stdin: content,
    });
    if (r.exitCode !== 0) throw new AppError('validation_failed', `Could not write ${relativeToWorkspace(abs)}: ${r.stderr.trim().slice(0, 300)}`);
    this.diskCache.delete(projectId);
    return { path: relativeToWorkspace(abs), bytes: Buffer.byteLength(content) };
  }

  async deleteFile(projectId: string, rel: string): Promise<void> {
    const abs = workspacePath(rel);
    const r = await this.exec({ projectId, kind: 'fs', actorUserId: null, log: false, timeoutS: 30, argv: ['rm', '-rf', '--', abs] });
    if (r.exitCode !== 0) throw new AppError('validation_failed', `Could not delete: ${r.stderr.trim().slice(0, 300)}`);
    this.diskCache.delete(projectId);
  }

  /** Interactive TTY shell for the terminal panel. */
  async openTerminal(projectId: string, actorUserId: string): Promise<{ stream: Duplex; resize: (cols: number, rows: number) => Promise<void>; executionId: string }> {
    const container = await this.ensureRunning(projectId);
    const row = await this.info(projectId);
    if (!row) throw new AppError('sandbox_unavailable', 'Sandbox missing.');
    const exec = await container.exec({
      Cmd: ['bash', '-l'],
      User: SANDBOX_UID,
      WorkingDir: WORKSPACE,
      Env: ['TERM=xterm-256color'],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });
    const stream = (await exec.start({ hijack: true, stdin: true, Tty: true }));
    const [e] = await this.db
      .insert(executions)
      .values({ sandboxId: row.id, actorUserId, kind: 'shell', command: '[interactive terminal]' })
      .returning({ id: executions.id });
    if (!e) throw new AppError('internal', 'Could not log terminal session.');
    const writer = new ExecLogWriter(this.db, e.id);
    stream.on('data', (b: Buffer) => writer.push('stdout', b.toString('utf8')));
    stream.on('close', () => {
      void writer.flush().then(() => this.db.update(executions).set({ finishedAt: new Date() }).where(eq(executions.id, e.id)));
    });
    return {
      stream,
      executionId: e.id,
      resize: async (cols, rows) => {
        await exec.resize({ w: cols, h: rows });
      },
    };
  }

  /** Stops sandboxes idle for longer than the configured window. */
  async reapIdle(): Promise<number> {
    const s = await this.db.query.globalSettings.findFirst({ where: eq(globalSettings.id, 1) });
    const cutoff = new Date(Date.now() - (s?.containerIdleMinutes ?? 30) * 60_000);
    const idle = await this.db
      .select({ projectId: sandboxes.projectId })
      .from(sandboxes)
      .where(and(eq(sandboxes.status, 'running'), lt(sandboxes.lastActivityAt, cutoff)));
    for (const r of idle) await this.stop(r.projectId).catch((err: unknown) => this.log.warn({ err: errMessage(err) }, 'idle stop failed'));
    return idle.length;
  }

  /** Aligns DB state with Docker after an API restart. */
  async reconcile(): Promise<void> {
    const rows = await this.db.select().from(sandboxes).where(inArray(sandboxes.status, ['running', 'creating']));
    for (const r of rows) {
      let running = false;
      if (r.containerId) {
        try {
          running = (await this.docker.getContainer(r.containerId).inspect()).State.Running;
        } catch (err) {
          if (!isNotFound(err)) throw err;
        }
      }
      if (!running) await this.db.update(sandboxes).set({ status: 'stopped', stoppedAt: new Date() }).where(eq(sandboxes.id, r.id));
    }
  }
}

/** Buffers output chunks and writes them to execution_logs in batches. */
class ExecLogWriter {
  private seq = 0;
  private bytes = 0;
  private pending: { stream: 'stdout' | 'stderr'; chunk: string }[] = [];
  private flushing: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly executionId: string,
  ) {}

  push(stream: 'stdout' | 'stderr', chunk: string): void {
    if (this.bytes >= MAX_LOG_BYTES_PER_EXEC) return;
    const room = MAX_LOG_BYTES_PER_EXEC - this.bytes;
    const c = chunk.length > room ? `${chunk.slice(0, room)}\n[log truncated]` : chunk;
    this.bytes += c.length;
    this.pending.push({ stream, chunk: c.replaceAll('\u0000', '') });
    this.timer ??= setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 250);
  }

  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.pending;
    this.pending = [];
    this.flushing = this.flushing.then(async () => {
      if (batch.length === 0) return;
      await this.db.insert(executionLogs).values(batch.map((b) => ({ executionId: this.executionId, stream: b.stream, seq: this.seq++, chunk: b.chunk })));
    });
    return this.flushing;
  }
}

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
