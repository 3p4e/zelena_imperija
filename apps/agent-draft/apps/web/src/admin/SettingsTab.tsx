import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GlobalSettings } from '@agent/shared';
import { api, errorMessage } from '../lib/api';
import { Button, Card, ErrorText, Field, Input } from '../components/ui';
import { ModelPicker } from '../workspace/ModelPicker';

const key = ['admin', 'settings'];

export function SettingsTab() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: key, queryFn: () => api.get<GlobalSettings>('/admin/settings') });
  const [form, setForm] = useState<GlobalSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);
  if (!form) return null;

  const save = async (): Promise<void> => {
    setError(null);
    setSaved(false);
    try {
      await api.put('/admin/settings', form);
      await qc.invalidateQueries({ queryKey: key });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const num = (k: keyof GlobalSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: Number(e.target.value) });
  const nullableNum = (k: 'adminCapPerTaskUsd' | 'adminCapPerDayUsd') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value === '' ? null : Number(e.target.value) });

  return (
    <div className="flex flex-col gap-5">
      <Card title="Your safety cap">
        <p className="mb-3 text-xs text-zinc-400">
          A circuit breaker on your own spend, checked by the server before every model call. It is not a quota: raise it or switch it off at any time. Leave a field empty to remove that cap.
        </p>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.adminSafetyCapEnabled} onChange={(e) => setForm({ ...form, adminSafetyCapEnabled: e.target.checked })} />
          Safety cap enabled
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Per task (USD)" hint="One agent turn, across all its steps.">
            <Input type="number" step="0.01" min="0" value={form.adminCapPerTaskUsd ?? ''} onChange={nullableNum('adminCapPerTaskUsd')} />
          </Field>
          <Field label="Per day (USD, UTC)">
            <Input type="number" step="0.01" min="0" value={form.adminCapPerDayUsd ?? ''} onChange={nullableNum('adminCapPerDayUsd')} />
          </Field>
        </div>
      </Card>
      <Card title="Defaults">
        <Field label="Server default model" hint="Used when no message, conversation, project or user default applies.">
          <ModelPicker value={{ modelId: form.defaultModelId, credentialMode: null, cliKind: null }} onChange={(s) => setForm({ ...form, defaultModelId: s.modelId })} inheritLabel="None" />
        </Field>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Field label="Max agent steps per turn">
            <Input type="number" value={form.agentMaxIterations} onChange={num('agentMaxIterations')} />
          </Field>
          <Field label="Command timeout (s)">
            <Input type="number" value={form.commandTimeoutS} onChange={num('commandTimeoutS')} />
          </Field>
          <Field label="Stop idle sandboxes after (min)">
            <Input type="number" value={form.containerIdleMinutes} onChange={num('containerIdleMinutes')} />
          </Field>
        </div>
      </Card>
      <Card title="Sandbox resources">
        <div className="grid grid-cols-4 gap-3 text-sm">
          <span className="col-span-4 text-xs text-zinc-500">Your sandboxes</span>
          <Field label="CPUs">
            <Input type="number" step="0.1" value={form.adminSandboxCpu} onChange={num('adminSandboxCpu')} />
          </Field>
          <Field label="Memory (MB)">
            <Input type="number" value={form.adminSandboxMemMb} onChange={num('adminSandboxMemMb')} />
          </Field>
          <Field label="Disk (MB)">
            <Input type="number" value={form.adminSandboxDiskMb} onChange={num('adminSandboxDiskMb')} />
          </Field>
          <Field label="Concurrent">
            <Input type="number" value={form.adminMaxContainers} onChange={num('adminMaxContainers')} />
          </Field>
          <span className="col-span-4 mt-2 text-xs text-zinc-500">Members (default; override per member on the Users tab)</span>
          <Field label="CPUs">
            <Input type="number" step="0.1" value={form.memberSandboxCpu} onChange={num('memberSandboxCpu')} />
          </Field>
          <Field label="Memory (MB)">
            <Input type="number" value={form.memberSandboxMemMb} onChange={num('memberSandboxMemMb')} />
          </Field>
          <Field label="Disk (MB)">
            <Input type="number" value={form.memberSandboxDiskMb} onChange={num('memberSandboxDiskMb')} />
          </Field>
          <Field label="Concurrent">
            <Input type="number" value={form.memberMaxContainers} onChange={num('memberMaxContainers')} />
          </Field>
        </div>
      </Card>
      <ErrorText error={error} />
      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-xs text-emerald-400">Saved</span>}
        <Button variant="primary" onClick={() => void save()}>
          Save settings
        </Button>
      </div>
    </div>
  );
}
