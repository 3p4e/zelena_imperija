import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Trash2 } from 'lucide-react';
import type { KeyTestResult } from '@agent/shared';
import { api, errorMessage } from '../lib/api';
import { relativeTime } from '../lib/format';
import { qk, useDefaults, useKeys, useProviders, useUsage } from '../lib/queries';
import { Badge, Button, Card, ErrorText, Field, Input, Select, Spinner } from '../components/ui';
import { UsageView } from '../components/UsageView';
import { ModelPicker, type Selection } from '../workspace/ModelPicker';

export function SettingsPage() {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 p-6">
        <KeysCard />
        <DefaultsCard />
        <PasswordCard />
        <MyUsageCard />
      </div>
    </div>
  );
}

function KeysCard() {
  const qc = useQueryClient();
  const keys = useKeys();
  const providers = useProviders();
  const [providerId, setProviderId] = useState('');
  const [label, setLabel] = useState('default');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, KeyTestResult>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    await qc.invalidateQueries({ queryKey: qk.keys });
    await qc.invalidateQueries({ queryKey: qk.models });
  };

  const save = async (): Promise<void> => {
    setError(null);
    setBusy('save');
    try {
      const saved = await api.post<{ id: string }>('/keys', { providerId, label, apiKey });
      setApiKey('');
      const result = await api.post<KeyTestResult>(`/keys/${saved.id}/test`);
      setTestResults((r) => ({ ...r, [saved.id]: result }));
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const test = async (id: string): Promise<void> => {
    setBusy(id);
    try {
      const result = await api.post<KeyTestResult>(`/keys/${id}/test`);
      setTestResults((r) => ({ ...r, [id]: result }));
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (id: string): Promise<void> => {
    if (!confirm('Revoke this key? The stored ciphertext is destroyed.')) return;
    try {
      await api.del(`/keys/${id}`);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Card title="API keys">
      <p className="mb-3 text-xs text-zinc-400">
        Keys are encrypted at rest and never shown again after saving. Requests made with your own keys are
        billed to you by the provider and are not subject to shared-key quotas.
      </p>
      <form
        className="mb-4 grid grid-cols-[1fr_1fr_2fr_auto] items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Provider">
          <Select required value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            <option value="">Choose…</option>
            {(['featured', 'cloud', 'local'] as const).map((cat) => {
              const inCat = (providers.data ?? []).filter((p) => p.category === cat);
              if (inCat.length === 0) return null;
              return (
                <optgroup key={cat} label={{ featured: 'Featured', cloud: 'Cloud', local: 'Local' }[cat]}>
                  {inCat.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </Select>
        </Field>
        <Field label="Label">
          <Input required value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="API key">
          <Input
            type="password"
            autoComplete="off"
            required
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Pasted key is sent once, over TLS"
          />
        </Field>
        <Button type="submit" variant="primary" loading={busy === 'save'}>
          Save & test
        </Button>
      </form>
      <ErrorText error={error} />
      {keys.isLoading && <Spinner />}
      <ul className="divide-y divide-zinc-800 rounded border border-zinc-800 text-sm">
        {keys.data?.map((k) => (
          <li key={k.id} className="flex items-center gap-3 px-3 py-2">
            <KeyRound className="size-4 text-zinc-500" />
            <div className="min-w-0 flex-1">
              <div>
                {k.providerSlug} · {k.label} <span className="font-mono text-zinc-500">••••{k.last4}</span>
              </div>
              <div className="text-xs text-zinc-500">
                tested {relativeTime(k.lastValidatedAt)}
                {testResults[k.id] && ` · ${testResults[k.id]?.message ?? ''}`}
                {testResults[k.id]?.ok && typeof testResults[k.id]?.modelsSeen === 'number'
                  ? ` · ${testResults[k.id]?.modelsSeen} models available`
                  : ''}
              </div>
            </div>
            <Badge tone={k.status === 'active' ? 'good' : k.status === 'invalid' ? 'bad' : 'neutral'}>
              {k.status}
            </Badge>
            {k.status !== 'revoked' && (
              <>
                <Button size="sm" onClick={() => void test(k.id)} loading={busy === k.id}>
                  Test
                </Button>
                <Button size="sm" variant="danger" aria-label="Revoke key" onClick={() => void revoke(k.id)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </>
            )}
          </li>
        ))}
        {keys.data?.length === 0 && <li className="px-3 py-2 text-xs text-zinc-500">No keys yet.</li>}
      </ul>
    </Card>
  );
}

function DefaultsCard() {
  const qc = useQueryClient();
  const defaults = useDefaults();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const value: Selection = {
    modelId: defaults.data?.defaultModelId ?? null,
    credentialMode: (defaults.data?.defaultCredentialMode as Selection['credentialMode']) ?? null,
    cliKind: null,
  };
  const save = async (s: Selection): Promise<void> => {
    setError(null);
    setSaved(false);
    try {
      await api.put('/me/defaults', {
        defaultModelId: s.modelId,
        defaultCredentialMode: s.credentialMode === 'subscription_cli' ? null : s.credentialMode,
      });
      await qc.invalidateQueries({ queryKey: qk.defaults });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Card title="Default model">
      <div className="flex items-center gap-3">
        <ModelPicker value={value} onChange={(s) => void save(s)} inheritLabel="Server default" />
        {saved && <span className="text-xs text-emerald-400">Saved</span>}
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Used when neither the message, the conversation nor the project picks a model.
      </p>
      <ErrorText error={error} />
    </Card>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="Password">
      <form
        className="grid grid-cols-[1fr_1fr_auto] items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setMsg(null);
          api
            .post('/auth/password', { currentPassword: current, newPassword: next })
            .then(() => {
              setMsg('Password changed.');
              setCurrent('');
              setNext('');
            })
            .catch((err: unknown) => setError(errorMessage(err)));
        }}
      >
        <Field label="Current password">
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field label="New password">
          <Input
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Button type="submit">Change</Button>
      </form>
      {msg && <p className="mt-2 text-xs text-emerald-400">{msg}</p>}
      <ErrorText error={error} />
    </Card>
  );
}

function MyUsageCard() {
  const usage = useUsage('/usage/summary', '');
  return (
    <Card title="My usage (all projects)">
      {usage.isLoading && <Spinner />}
      {usage.data && <UsageView summary={usage.data} />}
    </Card>
  );
}
