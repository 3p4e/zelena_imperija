import { PassThrough } from 'node:stream';
import { eq } from 'drizzle-orm';
import type Docker from 'dockerode';
import type { Logger } from 'pino';
import type { CliKind, CliProviderStatus } from '@agent/shared';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/client.js';
import { cliProviders, projects } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { SandboxManager } from '../sandbox/manager.js';
import { demux } from '../sandbox/docker.js';
import {
  CLI_LOGIN_MARKERS,
  JsonLineSplitter,
  PARSERS,
  cliArgv,
  newRunState,
  type CliEvent,
} from './parsers.js';

export interface CliRunRequest {
  kind: CliKind;
  projectId: string;
  ownerUserId: string;
  prompt: string;
  resumeSessionId: string | null;
  signal: AbortSignal;
  onEvent: (ev: CliEvent) => Promise<void>;
}

export interface CliRunResult {
  status: 'ok' | 'error' | 'stopped';
  sessionId: string | null;
  model: string | null;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
  errorMessage: string | null;
}

export interface CliRunner {
  readonly enabled: boolean;
  status(kind: CliKind): Promise<CliProviderStatus>;
  check(kind: CliKind): Promise<CliProviderStatus>;
  run(req: CliRunRequest): Promise<CliRunResult>;
}

/**
 * Subscription mode (admin only). Each run starts an ephemeral container from
 * the cli-runner image with:
 *   - the project's volume at /workspace,
 *   - the admin's own CLI home volume at /home/cli (populated by the admin's
 *     interactive `login` through the vendor's own flow),
 *   - the owner's sandbox network for egress.
 * The platform never reads, copies or proxies the vendor credentials; it only
 * starts the unmodified binary and reads its JSON output.
 */
export class DockerCliRunner implements CliRunner {
  constructor(
    private readonly db: Db,
    private readonly docker: Docker,
    private readonly sandbox: SandboxManager,
    private readonly config: AppConfig,
    private readonly log: Logger,
  ) {}

  get enabled(): boolean {
    return this.config.CLI_RUNNER_ENABLED;
  }

  async status(kind: CliKind): Promise<CliProviderStatus> {
    const row = await this.db.query.cliProviders.findFirst({ where: eq(cliProviders.kind, kind) });
    return {
      kind,
      enabled: row?.enabled ?? false,
      binaryVersion: row?.binaryVersion ?? null,
      loginState: row?.loginState ?? 'unknown',
      lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
      lastError: row?.lastError ?? (this.enabled ? null : 'CLI_RUNNER_ENABLED is false.'),
    };
  }

  /** Runs `<bin> --version` and tests for the vendor credential file (existence only). */
  async check(kind: CliKind): Promise<CliProviderStatus> {
    if (!this.enabled)
      throw new AppError('cli_unavailable', 'Subscription CLI mode is disabled (CLI_RUNNER_ENABLED=false).');
    const m = CLI_LOGIN_MARKERS[kind];
    let binaryVersion: string | null = null;
    let loginState: 'logged_in' | 'logged_out' | 'unknown' = 'unknown';
    let lastError: string | null = null;
    try {
      const { output, exitCode } = await this.oneShot([
        'sh',
        '-c',
        `${m.bin} --version 2>&1 | head -n 1; if [ -f "$HOME/${m.credentialFile}" ]; then echo __LOGGED_IN__; else echo __LOGGED_OUT__; fi`,
      ]);
      // CLIs may print startup warnings first; take the line that carries a version number.
      const lines = output
        .trim()
        .split('\n')
        .filter((l) => !l.startsWith('__LOGGED'));
      binaryVersion = (lines.find((l) => /\d+\.\d+\.\d+/.test(l)) ?? lines[0])?.trim().slice(0, 120) ?? null;
      loginState = output.includes('__LOGGED_IN__') ? 'logged_in' : 'logged_out';
      if (exitCode !== 0) lastError = `Check exited with ${exitCode}.`;
      if (loginState === 'logged_out') lastError = `Not logged in. On the server run: ${m.loginHint}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 300) : 'Check failed.';
    }
    await this.db
      .update(cliProviders)
      .set({ binaryVersion, loginState, lastError, lastCheckedAt: new Date() })
      .where(eq(cliProviders.kind, kind));
    return this.status(kind);
  }

  private async oneShot(cmd: string[]): Promise<{ output: string; exitCode: number }> {
    const container = await this.docker.createContainer({
      Image: this.config.CLI_RUNNER_IMAGE,
      Cmd: cmd,
      User: '1000:1000',
      Env: ['HOME=/home/cli'],
      Labels: { 'agent.managed': '1', 'agent.cli': 'check' },
      HostConfig: {
        // Writable: the CLIs create their config directories on startup. Credentials are only tested for existence.
        Mounts: [{ Type: 'volume', Source: this.config.CLI_HOME_VOLUME, Target: '/home/cli' }],
        NetworkMode: 'none',
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
      },
    });
    try {
      await container.start();
      const res = (await container.wait()) as { StatusCode: number };
      const logs = await container.logs({ stdout: true, stderr: true });
      return { output: demuxBuffer(logs), exitCode: res.StatusCode };
    } finally {
      await container.remove({ force: true }).catch(() => undefined);
    }
  }

  async run(req: CliRunRequest): Promise<CliRunResult> {
    if (!this.enabled)
      throw new AppError('cli_unavailable', 'Subscription CLI mode is disabled on this server.');
    const status = await this.status(req.kind);
    if (!status.enabled)
      throw new AppError(
        'cli_unavailable',
        `${req.kind} is not enabled. Enable it in Admin → Subscription CLIs.`,
      );
    const project = await this.db.query.projects.findFirst({ where: eq(projects.id, req.projectId) });
    if (!project) throw new AppError('not_found', 'Project not found.');

    // Make sure the project volume and the owner's network exist.
    const sandboxContainer = await this.sandbox.ensureRunning(req.projectId);
    const sbx = await sandboxContainer.inspect();
    const volume = sbx.Mounts.find((m) => m.Destination === '/workspace')?.Name;
    if (!volume) throw new AppError('sandbox_unavailable', 'Project volume not found.');
    const limits = await this.sandbox.limitsFor(req.ownerUserId);

    const container = await this.docker.createContainer({
      Image: this.config.CLI_RUNNER_IMAGE,
      Cmd: cliArgv(req.kind, req.prompt, req.resumeSessionId),
      User: '1000:1000',
      WorkingDir: '/workspace',
      Env: ['HOME=/home/cli', 'CI=1', 'NO_COLOR=1'],
      Labels: { 'agent.managed': '1', 'agent.cli': req.kind, 'agent.project': req.projectId },
      Tty: false,
      HostConfig: {
        Mounts: [
          { Type: 'volume', Source: volume, Target: '/workspace' },
          { Type: 'volume', Source: this.config.CLI_HOME_VOLUME, Target: '/home/cli' },
        ],
        NetworkMode: sbx.HostConfig.NetworkMode ?? 'none',
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        Memory: limits.memMb * 1024 * 1024,
        NanoCpus: Math.round(limits.cpu * 1e9),
        PidsLimit: 512,
        Init: true,
      },
    });

    const state = newRunState();
    const toolNames = new Map<string, string>();
    const splitter = new JsonLineSplitter();
    const parse = PARSERS[req.kind];
    let queue: Promise<void> = Promise.resolve();
    let stderrTail = '';

    const stream = await container.attach({ stream: true, stdout: true, stderr: true });
    const out = new PassThrough();
    const err = new PassThrough();
    demux(container.modem, stream, out, err);
    out.on('data', (b: Buffer) => {
      for (const line of splitter.push(b.toString('utf8'))) {
        for (const ev of parse(line, state, toolNames)) queue = queue.then(() => req.onEvent(ev));
      }
    });
    err.on('data', (b: Buffer) => {
      stderrTail = (stderrTail + b.toString('utf8')).slice(-2000);
    });

    let stopped = false;
    const onAbort = (): void => {
      stopped = true;
      void container.kill({ signal: 'SIGINT' }).catch(() => undefined);
      setTimeout(() => void container.kill().catch(() => undefined), 5000).unref();
    };
    req.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      state.errorMessage = `The CLI run exceeded ${this.config.CLI_RUN_TIMEOUT_S} s and was stopped.`;
      void container.kill().catch(() => undefined);
    }, this.config.CLI_RUN_TIMEOUT_S * 1000);

    let exitCode: number;
    try {
      await container.start();
      exitCode = ((await container.wait()) as { StatusCode: number }).StatusCode;
    } finally {
      clearTimeout(timer);
      req.signal.removeEventListener('abort', onAbort);
      for (const line of splitter.end())
        for (const ev of parse(line, state, toolNames)) queue = queue.then(() => req.onEvent(ev));
      await queue;
      await container.remove({ force: true }).catch(() => undefined);
    }

    if (stopped)
      return {
        status: 'stopped',
        sessionId: state.sessionId,
        model: state.model,
        usage: state.usage,
        errorMessage: null,
      };
    if (exitCode !== 0 || state.errorMessage) {
      const message =
        state.errorMessage ??
        (stderrTail.trim()
          ? `CLI exited with ${exitCode}: ${stderrTail.trim().slice(-400)}`
          : `CLI exited with ${exitCode}.`);
      this.log.warn({ kind: req.kind, exitCode }, 'cli run failed');
      return {
        status: 'error',
        sessionId: state.sessionId,
        model: state.model,
        usage: state.usage,
        errorMessage: message,
      };
    }
    return {
      status: 'ok',
      sessionId: state.sessionId,
      model: state.model,
      usage: state.usage,
      errorMessage: null,
    };
  }
}

/** Decodes Docker's multiplexed log format (8-byte frame headers). */
function demuxBuffer(buf: Buffer): string {
  let out = '';
  let i = 0;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i + 4);
    out += buf.subarray(i + 8, i + 8 + len).toString('utf8');
    i += 8 + len;
  }
  return out || buf.toString('utf8');
}
