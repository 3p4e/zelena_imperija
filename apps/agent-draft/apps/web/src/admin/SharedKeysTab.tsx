import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminUserRow, Model, SharedKeyGrant } from '@agent/shared';
import { api, errorMessage } from '../lib/api';
import { usd } from '../lib/format';
import { useKeys } from '../lib/queries';
import { Badge, Button, Card, ErrorText, Field, Input, Modal, Select } from '../components/ui';

const key = ['admin', 'grants'];

export function SharedKeysTab() {
  const qc = useQueryClient();
  const grants = useQuery({
    queryKey: key,
    queryFn: () => api.get<SharedKeyGrant[]>('/admin/shared-grants'),
  });
  const users = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api.get<AdminUserRow[]>('/admin/users'),
  });
  const models = useQuery({
    queryKey: ['admin', 'models'],
    queryFn: () => api.get<Model[]>('/admin/models'),
  });
  const keys = useKeys();
  const [editing, setEditing] = useState<SharedKeyGrant | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Card
      title="Shared keys"
      actions={
        <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
          Grant access
        </Button>
      }
    >
      <p className="mb-3 text-xs text-zinc-400">
        Members use your keys through the server only; they never see the key. Quotas are checked before every
        request using estimated cost. Your own usage is never limited by grants.
      </p>
      <ErrorText error={error} />
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-zinc-500">
          <tr>
            <th className="py-1">Member</th>
            <th>Key</th>
            <th>Today</th>
            <th>This month</th>
            <th>Models</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {grants.data?.map((g) => (
            <tr key={g.id}>
              <td className="py-2">{g.memberEmail}</td>
              <td>
                {g.providerSlug} · {g.keyLabel}
              </td>
              <td className="text-xs">
                {usd(g.spentTodayUsd)} / {usd(g.dailyLimitUsd)}
              </td>
              <td className="text-xs">
                {usd(g.spentMonthUsd)} / {usd(g.monthlyLimitUsd)}
              </td>
              <td className="text-xs">{g.allowedModelIds.length === 0 ? 'all' : g.allowedModelIds.length}</td>
              <td>
                <div className="flex justify-end gap-1">
                  {!g.enabled && <Badge tone="bad">disabled</Badge>}
                  <Button size="sm" onClick={() => setEditing(g)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void act(() => api.del(`/admin/shared-grants/${g.id}`))}
                  >
                    Remove
                  </Button>
                </div>
              </td>
            </tr>
          ))}
          {grants.data?.length === 0 && (
            <tr>
              <td colSpan={6} className="py-2 text-xs text-zinc-500">
                No grants yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {editing && (
        <GrantDialog
          grant={editing === 'new' ? null : editing}
          members={(users.data ?? []).filter((u) => u.role === 'member')}
          keys={(keys.data ?? []).filter((k) => k.status === 'active')}
          models={models.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => void qc.invalidateQueries({ queryKey: key })}
        />
      )}
    </Card>
  );
}

function GrantDialog({
  grant,
  members,
  keys,
  models,
  onClose,
  onSaved,
}: {
  grant: SharedKeyGrant | null;
  members: AdminUserRow[];
  keys: { id: string; providerId: string; providerSlug: string; label: string }[];
  models: Model[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [memberUserId, setMember] = useState(grant?.memberUserId ?? '');
  const [userKeyId, setKey] = useState(grant?.userKeyId ?? '');
  const [daily, setDaily] = useState(String(grant?.dailyLimitUsd ?? 2));
  const [monthly, setMonthly] = useState(String(grant?.monthlyLimitUsd ?? 20));
  const [enabled, setEnabled] = useState(grant?.enabled ?? true);
  const [allowed, setAllowed] = useState<Set<string>>(new Set(grant?.allowedModelIds ?? []));
  const [error, setError] = useState<string | null>(null);
  const providerId = keys.find((k) => k.id === userKeyId)?.providerId;
  const providerModels = models.filter((m) => m.providerId === providerId);

  const save = async (): Promise<void> => {
    try {
      const body = {
        dailyLimitUsd: Number(daily),
        monthlyLimitUsd: Number(monthly),
        enabled,
        allowedModelIds: [...allowed],
      };
      if (grant) await api.patch(`/admin/shared-grants/${grant.id}`, body);
      else await api.post('/admin/shared-grants', { ...body, memberUserId, userKeyId });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Modal title={grant ? 'Edit grant' : 'Grant shared key access'} open onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Member">
          <Select value={memberUserId} disabled={!!grant} onChange={(e) => setMember(e.target.value)}>
            <option value="">Choose…</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.email}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Your key">
          <Select value={userKeyId} disabled={!!grant} onChange={(e) => setKey(e.target.value)}>
            <option value="">Choose…</option>
            {keys.map((k) => (
              <option key={k.id} value={k.id}>
                {k.providerSlug} · {k.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Daily limit (USD)">
          <Input type="number" step="0.01" min="0" value={daily} onChange={(e) => setDaily(e.target.value)} />
        </Field>
        <Field label="Monthly limit (USD)">
          <Input
            type="number"
            step="0.01"
            min="0"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
          />
        </Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
      </label>
      <div className="mt-3 text-sm">
        <div className="mb-1 text-zinc-300">
          Allowed models (none selected = every model of this provider)
        </div>
        <div className="grid max-h-56 grid-cols-2 gap-1 overflow-auto rounded border border-zinc-800 p-2 text-xs">
          {providerModels.map((m) => (
            <label key={m.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allowed.has(m.id)}
                onChange={(e) => {
                  const next = new Set(allowed);
                  if (e.target.checked) next.add(m.id);
                  else next.delete(m.id);
                  setAllowed(next);
                }}
              />
              {m.displayName}
            </label>
          ))}
          {providerModels.length === 0 && <span className="text-zinc-500">Pick a key first.</span>}
        </div>
      </div>
      <ErrorText error={error} />
      <div className="mt-3 flex justify-end">
        <Button variant="primary" onClick={() => void save()} disabled={!memberUserId || !userKeyId}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
