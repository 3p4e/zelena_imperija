import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CliProviderStatus } from '@agent/shared';
import { adminClient, newProject, startHarness, type Client, type Harness } from '../helpers/harness.js';

const VOLUME = 'agent-test-cli-home';

/**
 * Drives the unmodified vendor CLIs in the cli-runner image through the real API.
 * The CLI home volume is empty here (no vendor login), so a working pipeline must
 * report "logged out" on the status check and surface each CLI's own
 * authentication failure in the chat. A logged-in run is the admin's manual check.
 */
describe('subscription CLI runner (unmodified binaries, no login)', () => {
  let h: Harness;
  let admin: Client;

  beforeAll(async () => {
    execFileSync('docker', ['image', 'inspect', 'agent-cli-runner:latest'], { stdio: 'ignore' });
    execFileSync('docker', ['volume', 'rm', '-f', VOLUME], { stdio: 'ignore' });
    h = await startHarness('cli', {
      CLI_RUNNER_ENABLED: 'true',
      CLI_HOME_VOLUME: VOLUME,
      CLI_RUN_TIMEOUT_S: '120',
    });
    admin = await adminClient(h);
  });
  afterAll(async () => {
    await h.close();
    execFileSync('docker', ['volume', 'rm', '-f', VOLUME], { stdio: 'ignore' });
  });

  it.each([
    ['claude_code', /Claude Code/],
    ['codex', /codex-cli/],
    ['gemini_cli', /^\d+\.\d+/],
  ] as const)('%s: status check reads the binary version and reports logged out', async (kind, version) => {
    expect((await admin.patch(`/api/admin/cli/${kind}`, { enabled: true })).status).toBe(200);
    const s = await admin.post<CliProviderStatus>(`/api/admin/cli/${kind}/check`);
    expect(s.status).toBe(200);
    expect(s.body.binaryVersion).toMatch(version);
    expect(s.body.loginState).toBe('logged_out');
    expect(s.body.lastError).toContain('docker compose run --rm cli-runner');
    const options = await admin.get<{ kind: string }[]>('/api/cli/options');
    expect(options.body.map((o) => o.kind)).toContain(kind);
  });

  it('claude_code: a headless run executes in the project and reports the CLI’s own auth error', async () => {
    const { conversationId } = await newProject(admin, 'CLI run');
    const run = await admin.sse(`/api/conversations/${conversationId}/messages`, {
      content: 'Create hello.txt',
      credentialMode: 'subscription_cli',
      cliKind: 'claude_code',
    });
    const end = run.events.find((e) => e.type === 'message_end');
    expect(end).toMatchObject({ status: 'error', errorCode: 'cli_unavailable' });
    expect(JSON.stringify(run.events)).toMatch(/log ?in|auth|API key/i);
    const records =
      await admin.get<{ credentialSource: string; providerSlug: string; status: string }[]>(
        '/api/usage/records',
      );
    expect(records.body[0]).toMatchObject({
      credentialSource: 'subscription_cli',
      providerSlug: 'claude_code',
      status: 'error',
    });
    // The runner container was removed after the run.
    const leftovers = execFileSync('docker', ['ps', '-aq', '--filter', 'label=agent.cli=claude_code'])
      .toString()
      .trim();
    expect(leftovers).toBe('');
  });

  it('a disabled CLI cannot be used', async () => {
    await admin.patch('/api/admin/cli/codex', { enabled: false });
    const { conversationId } = await newProject(admin, 'Disabled CLI');
    const run = await admin.sse(`/api/conversations/${conversationId}/messages`, {
      content: 'x',
      credentialMode: 'subscription_cli',
      cliKind: 'codex',
    });
    expect(run.events.find((e) => e.type === 'message_end')).toMatchObject({
      status: 'error',
      errorCode: 'cli_unavailable',
    });
    expect(JSON.stringify(run.events)).toContain('not enabled');
  });
});
