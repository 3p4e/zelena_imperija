import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminClient,
  createMember,
  newProject,
  startHarness,
  type Client,
  type Harness,
} from '../helpers/harness.js';

const FIREWALL = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../infra/host/sandbox-firewall.sh',
);

/**
 * Runs against the real Docker daemon. These are the guarantees the platform
 * relies on for running agent-generated code; none of them are mocked.
 */
describe('sandbox isolation', () => {
  let h: Harness;
  let admin: Client;
  let alice: Client;
  let bob: Client;
  let aliceId: string;
  let projectA: string;
  let projectB: string;
  let hostDir: string;

  beforeAll(async () => {
    h = await startHarness('sbx');
    admin = await adminClient(h);
    ({ client: alice, id: aliceId } = await createMember(h, admin, 'alice@sbx.local'));
    ({ client: bob } = await createMember(h, admin, 'bob@sbx.local'));
    ({ projectId: projectA } = await newProject(alice, 'A'));
    ({ projectId: projectB } = await newProject(bob, 'B'));
    await h.deps.sandbox.ensureRunning(projectA);
    await h.deps.sandbox.ensureRunning(projectB);
    hostDir = mkdtempSync(path.join(os.tmpdir(), 'host-marker-'));
  });
  afterAll(async () => {
    rmSync(hostDir, { recursive: true, force: true });
    await h.close();
  });

  const run = async (projectId: string, command: string, timeoutS = 20) =>
    h.deps.sandbox.exec({ projectId, command, kind: 'shell', actorUserId: null, timeoutS });

  it('cannot see or reach the host filesystem', async () => {
    const marker = path.join(hostDir, `secret-${randomBytes(4).toString('hex')}`);
    writeFileSync(marker, 'host secret');
    const r = await run(
      projectA,
      `test -e ${marker} && echo VISIBLE || echo absent; ls /var/run/docker.sock 2>&1 || true; cat /etc/hostname`,
    );
    expect(r.stdout).toContain('absent');
    expect(r.stdout).toContain('No such file');
    expect(r.stdout).not.toContain(os.hostname());

    // No bind mounts at all: only the project volume and tmpfs.
    const info = await h.deps.sandbox.info(projectA);
    const inspect = JSON.parse(execFileSync('docker', ['inspect', info?.containerId ?? '']).toString()) as {
      Mounts: { Type: string; Destination: string }[];
      HostConfig: {
        Binds: string[] | null;
        Privileged: boolean;
        CapDrop: string[];
        ReadonlyRootfs: boolean;
        SecurityOpt: string[];
      };
      Config: { User: string };
    }[];
    const c = inspect[0];
    expect(c?.Mounts.map((m) => m.Type)).toEqual(['volume']);
    expect(c?.HostConfig.Binds ?? []).toEqual([]);
    expect(c?.HostConfig.Privileged).toBe(false);
    expect(c?.HostConfig.CapDrop).toContain('ALL');
    expect(c?.HostConfig.ReadonlyRootfs).toBe(true);
    expect(c?.HostConfig.SecurityOpt).toContain('no-new-privileges');
    expect(c?.Config.User).toBe('1000:1000');

    // Cannot escalate: no root, no mounting, root fs read-only.
    const esc = await run(
      projectA,
      'id -u; mount -t tmpfs none /mnt 2>&1 || echo MOUNT_DENIED; touch /etc/x 2>&1 || echo RO_ROOT; sudo -n true 2>&1 || echo NO_SUDO',
    );
    expect(esc.stdout).toMatch(/^1000/);
    expect(esc.stdout).toContain('MOUNT_DENIED');
    expect(esc.stdout).toContain('RO_ROOT');
    expect(esc.stdout).toContain('NO_SUDO');
  });

  it('rejects paths that escape the workspace', async () => {
    await expect(h.deps.sandbox.readFile(projectA, '../../etc/passwd')).rejects.toThrow(/escapes|Invalid/);
    await expect(h.deps.sandbox.writeFile(projectA, '/workspace/../tmp/x', 'x', null)).rejects.toThrow(
      /escapes|Invalid/,
    );
  });

  it('enforces the command timeout and kills the process', async () => {
    const started = Date.now();
    const r = await run(projectA, 'sleep 60; echo SHOULD_NOT_PRINT', 2);
    expect(r.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(r.stdout).not.toContain('SHOULD_NOT_PRINT');
    // The bracket keeps pgrep from matching its own command line; PID 1's `sleep infinity` is excluded.
    const ps = await run(projectA, 'pgrep -f "slee[p] 60" || echo NONE');
    expect(ps.stdout.trim()).toBe('NONE');
    // The timeout is recorded in the execution log.
    const execs = await alice.get<{ command: string; timedOut: boolean }[]>(
      `/api/projects/${projectA}/executions`,
    );
    expect(execs.body.find((e) => e.command.startsWith('sleep 60'))?.timedOut).toBe(true);
  });

  it("one user's container cannot reach another user's container", async () => {
    await run(projectB, 'nohup python3 -m http.server 9000 --bind 0.0.0.0 > /tmp/s.log 2>&1 &');
    const ipB = await h.deps.sandbox.containerIp(projectB);
    // Positive control: B can reach its own server.
    const own = await run(
      projectB,
      'for i in $(seq 1 20); do curl -s -m 2 -o /dev/null -w "%{http_code}" http://127.0.0.1:9000/ && exit 0; sleep 0.5; done; exit 1',
    );
    expect(own.stdout).toContain('200');
    const cross = await run(
      projectA,
      `curl -s -m 4 -o /dev/null -w "%{http_code}" http://${ipB}:9000/ || echo UNREACHABLE`,
    );
    expect(cross.stdout).toContain('UNREACHABLE');
    const ipA = await h.deps.sandbox.containerIp(projectA);
    expect(ipA.split('.').slice(0, 3).join('.')).not.toBe(ipB.split('.').slice(0, 3).join('.'));
  });

  it('cannot reach services on the Docker host once the firewall script is applied', async () => {
    const server = http.createServer((_req, res) => res.end('host service'));
    await new Promise<void>((r) => server.listen(0, '0.0.0.0', r));
    const port = (server.address() as { port: number }).port;
    try {
      execFileSync('sh', [FIREWALL], { stdio: 'pipe' });
      const ip = await h.deps.sandbox.containerIp(projectA);
      const gateway = `${ip.split('.').slice(0, 3).join('.')}.1`;
      const r = await run(projectA, `curl -s -m 4 http://${gateway}:${port}/ || echo BLOCKED`);
      expect(r.stdout).toContain('BLOCKED');
      // Egress to the internet is unaffected (blocked only if the host itself has no route).
      const metadata = await run(projectA, 'curl -s -m 4 http://169.254.169.254/ || echo BLOCKED');
      expect(metadata.stdout).toContain('BLOCKED');
    } finally {
      server.close();
    }
  });

  it('applies per-member resource limits and the concurrent container cap', async () => {
    const limits = await admin.put(`/api/admin/users/${aliceId}/limits`, {
      sandboxCpu: 0.5,
      sandboxMemMb: 256,
      sandboxDiskMb: 128,
      maxContainers: 1,
      networkMode: 'egress',
    });
    expect(limits.status).toBe(200);
    await h.deps.sandbox.stop(projectA);
    await h.deps.sandbox.ensureRunning(projectA);
    const info = await h.deps.sandbox.info(projectA);
    const inspect = JSON.parse(execFileSync('docker', ['inspect', info?.containerId ?? '']).toString()) as {
      HostConfig: { Memory: number; NanoCpus: number; PidsLimit: number };
    }[];
    expect(inspect[0]?.HostConfig).toMatchObject({
      Memory: 256 * 1024 * 1024,
      NanoCpus: 500_000_000,
      PidsLimit: 512,
    });

    // Second running sandbox for Alice is refused.
    const { projectId: second } = await newProject(alice, 'A2');
    const res = await alice.post<{ error: { code: string } }>(`/api/projects/${second}/sandbox/start`);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('sandbox_limit_reached');

    // Disk quota: exceeding it blocks further commands with a clear message.
    await run(projectA, 'head -c 140M /dev/zero > big.bin', 60);
    const write = await alice.put<{ error: { code: string; message: string } }>(
      `/api/projects/${projectA}/files/content`,
      { path: 'x.txt', content: 'x' },
    );
    expect(write.status).toBe(429);
    expect(write.body.error.message).toContain('disk limit');
  });

  it('a member with network mode "none" has no network at all', async () => {
    const { client: carol, id: carolId } = await createMember(h, admin, 'carol@sbx.local');
    expect(
      (
        await admin.put(`/api/admin/users/${carolId}/limits`, {
          sandboxCpu: 0.5,
          sandboxMemMb: 256,
          sandboxDiskMb: 256,
          maxContainers: 1,
          networkMode: 'none',
        })
      ).status,
    ).toBe(200);
    const { projectId } = await newProject(carol, 'Offline');
    const r = await run(
      projectId,
      'curl -s -m 4 https://example.com >/dev/null && echo ONLINE || echo OFFLINE',
    );
    expect(r.stdout).toContain('OFFLINE');
  });
});
