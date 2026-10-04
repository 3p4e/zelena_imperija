import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CliProviderStatus } from '@agent/shared';
import { api, errorMessage } from '../lib/api';
import { CLI_LABELS, relativeTime } from '../lib/format';
import { qk } from '../lib/queries';
import { Badge, Button, Card, ErrorText } from '../components/ui';

const key = ['admin', 'cli'];

const LOGIN_COMMANDS: Record<string, string> = {
  claude_code: 'docker compose run --rm cli-runner claude   # then type /login',
  codex: 'docker compose run --rm cli-runner codex login --device-auth',
  gemini_cli: 'docker compose run --rm cli-runner gemini   # choose "Login with Google"',
};

/**
 * Subscription mode runs each vendor's unmodified CLI under your own login.
 * The platform never reads or stores the vendor credentials; you log in on the
 * server with the vendor's own flow. Admin only.
 */
export function CliTab() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: key, queryFn: () => api.get<CliProviderStatus[]>('/admin/cli') });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (id: string, fn: () => Promise<unknown>): Promise<void> => {
    setError(null);
    setBusy(id);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: key });
      await qc.invalidateQueries({ queryKey: qk.cliOptions });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="Subscription CLIs (admin only)">
      <p className="mb-3 text-xs text-zinc-400">
        Runs Claude Code, Codex CLI or Gemini CLI headless inside an isolated container with your project mounted. You log in once on the server through each vendor's own flow;
        the login stays in a private Docker volume. Usage counts against your subscription limits, not API spend. Requires CLI_RUNNER_ENABLED=true and the cli-runner image.
      </p>
      <ErrorText error={error} />
      <ul className="flex flex-col gap-3">
        {status.data?.map((s) => (
          <li key={s.kind} className="rounded-md border border-zinc-800 p-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">{CLI_LABELS[s.kind] ?? s.kind}</span>
              <Badge tone={s.loginState === 'logged_in' ? 'good' : s.loginState === 'logged_out' ? 'bad' : 'neutral'}>{s.loginState.replace('_', ' ')}</Badge>
              {s.binaryVersion && <span className="font-mono text-xs text-zinc-500">{s.binaryVersion}</span>}
              <div className="ml-auto flex gap-2">
                <Button size="sm" loading={busy === `c${s.kind}`} onClick={() => void act(`c${s.kind}`, () => api.post(`/admin/cli/${s.kind}/check`))}>
                  Check status
                </Button>
                <Button size="sm" variant={s.enabled ? 'secondary' : 'primary'} onClick={() => void act(`e${s.kind}`, () => api.patch(`/admin/cli/${s.kind}`, { enabled: !s.enabled }))}>
                  {s.enabled ? 'Disable' : 'Enable'}
                </Button>
              </div>
            </div>
            <div className="mt-1 text-xs text-zinc-500">checked {relativeTime(s.lastCheckedAt)}</div>
            {s.lastError && <div className="mt-1 text-xs text-amber-300">{s.lastError}</div>}
            <div className="mt-2 text-xs text-zinc-400">Log in on the server:</div>
            <code className="mt-1 block rounded bg-zinc-950 px-2 py-1 font-mono text-xs">{LOGIN_COMMANDS[s.kind]}</code>
          </li>
        ))}
      </ul>
    </Card>
  );
}
