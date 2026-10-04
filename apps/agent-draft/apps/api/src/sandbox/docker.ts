import { PassThrough } from 'node:stream';
import Docker from 'dockerode';

export function createDocker(dockerHost: string): Docker {
  if (dockerHost.startsWith('unix://')) return new Docker({ socketPath: dockerHost.slice('unix://'.length) });
  const url = new URL(dockerHost.replace(/^tcp:/, 'http:'));
  return new Docker({ host: url.hostname, port: Number(url.port || 2375), protocol: 'http' });
}

export interface ExecOptions {
  cmd: string[];
  user?: string;
  workingDir?: string;
  env?: string[];
  stdin?: string | Buffer;
  /** Hard server-side deadline, ms. The in-container `timeout` wrapper normally fires first. */
  deadlineMs: number;
  signal?: AbortSignal | undefined;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  /** Max bytes kept in memory per stream for the return value. */
  captureLimit?: number;
}

export interface ExecOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  truncated: boolean;
  deadlineHit: boolean;
  aborted: boolean;
}

/** Runs a command in a container via the Docker exec API and collects demultiplexed output. */
export async function dockerExec(container: Docker.Container, opts: ExecOptions): Promise<ExecOutcome> {
  const exec = await container.exec({
    Cmd: opts.cmd,
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: opts.stdin !== undefined,
    User: opts.user ?? '1000:1000',
    WorkingDir: opts.workingDir ?? '/workspace',
    Env: opts.env ?? [],
    Tty: false,
  });
  const stream = (await exec.start({ hijack: true, stdin: opts.stdin !== undefined }));
  const limit = opts.captureLimit ?? 1024 * 1024;
  const out = new PassThrough();
  const err = new PassThrough();
  let stdout = '';
  let stderr = '';
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let truncated = false;

  out.on('data', (b: Buffer) => {
    stdoutBytes += b.length;
    const s = b.toString('utf8');
    if (stdout.length < limit) stdout += s.slice(0, limit - stdout.length);
    else truncated = true;
    opts.onStdout?.(s);
  });
  err.on('data', (b: Buffer) => {
    stderrBytes += b.length;
    const s = b.toString('utf8');
    if (stderr.length < limit) stderr += s.slice(0, limit - stderr.length);
    else truncated = true;
    opts.onStderr?.(s);
  });
  demux(container.modem, stream, out, err);

  if (opts.stdin !== undefined) {
    stream.write(opts.stdin);
    stream.end();
  }

  let deadlineHit = false;
  let aborted = false;
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(() => {
      deadlineHit = true;
      stream.destroy();
      finish();
    }, opts.deadlineMs);
    const onAbort = (): void => {
      aborted = true;
      stream.destroy();
      finish();
    };
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener('abort', onAbort, { once: true });
    stream.on('end', finish);
    stream.on('close', finish);
    stream.on('error', finish);
  });

  let exitCode: number | null = null;
  if (!deadlineHit && !aborted) {
    // The exec may report Running briefly after the stream closes.
    for (let i = 0; i < 20; i++) {
      const info = await exec.inspect();
      if (!info.Running) {
        exitCode = info.ExitCode;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  return { exitCode, stdout, stderr, stdoutBytes, stderrBytes, truncated, deadlineHit, aborted };
}

/** dockerode's modem is untyped; this is its documented demultiplexer for non-TTY streams. */
export function demux(modem: unknown, stream: NodeJS.ReadableStream, out: NodeJS.WritableStream, err: NodeJS.WritableStream): void {
  (modem as { demuxStream: (s: NodeJS.ReadableStream, o: NodeJS.WritableStream, e: NodeJS.WritableStream) => void }).demuxStream(stream, out, err);
}

export function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { statusCode?: number }).statusCode === 404;
}
