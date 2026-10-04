import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminUserRow, Invite, MemberLimits, ToolCatalogEntry } from '@agent/shared';
import { api, errorMessage } from '../lib/api';
import { relativeTime } from '../lib/format';
import { Badge, Button, Card, ErrorText, Field, Input, Modal, Select } from '../components/ui';

const usersKey = ['admin', 'users'];
const invitesKey = ['admin', 'invites'];

export function UsersTab() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: usersKey, queryFn: () => api.get<AdminUserRow[]>('/admin/users') });
  const invites = useQuery({ queryKey: invitesKey, queryFn: () => api.get<Invite[]>('/admin/invites') });
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ title: string; url: string } | null>(null);
  const [limitsFor, setLimitsFor] = useState<AdminUserRow | null>(null);
  const [toolsFor, setToolsFor] = useState<AdminUserRow | null>(null);

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: usersKey });
      await qc.invalidateQueries({ queryKey: invitesKey });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <CreateUser
        onLink={(title, url) => setLink({ title, url })}
        onDone={() => {
          void qc.invalidateQueries({ queryKey: usersKey });
          void qc.invalidateQueries({ queryKey: invitesKey });
        }}
      />
      <ErrorText error={error} />
      <Card title="Users">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-zinc-500">
            <tr>
              <th className="py-1">User</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last seen</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {users.data?.map((u) => (
              <tr key={u.id}>
                <td className="py-2">
                  <div>{u.displayName}</div>
                  <div className="text-xs text-zinc-500">{u.email}</div>
                </td>
                <td>
                  <Badge tone={u.role === 'admin' ? 'warn' : 'neutral'}>{u.role}</Badge>
                </td>
                <td>
                  <Badge tone={u.status === 'active' ? 'good' : 'bad'}>{u.status}</Badge>
                </td>
                <td className="text-xs text-zinc-400">{relativeTime(u.lastSeenAt)}</td>
                <td>
                  <div className="flex justify-end gap-1">
                    {u.role === 'member' && (
                      <>
                        <Button size="sm" onClick={() => setLimitsFor(u)}>
                          Limits
                        </Button>
                        <Button size="sm" onClick={() => setToolsFor(u)}>
                          Tools
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      onClick={() =>
                        void act(async () => {
                          const r = await api.post<{ url: string }>(`/admin/users/${u.id}/reset-link`);
                          setLink({ title: `Password reset link for ${u.email} (24 h)`, url: r.url });
                        })
                      }
                    >
                      Reset link
                    </Button>
                    {u.role === 'member' && (
                      <Button
                        size="sm"
                        variant={u.status === 'active' ? 'danger' : 'secondary'}
                        onClick={() =>
                          void act(() =>
                            api.patch(`/admin/users/${u.id}/status`, {
                              status: u.status === 'active' ? 'suspended' : 'active',
                            }),
                          )
                        }
                      >
                        {u.status === 'active' ? 'Suspend' : 'Reactivate'}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Pending invites">
        <ul className="divide-y divide-zinc-800 text-sm">
          {invites.data?.map((i) => (
            <li key={i.id} className="flex items-center gap-3 py-2">
              <span className="flex-1">{i.email}</span>
              <Badge>{i.role}</Badge>
              <span className="text-xs text-zinc-500">expires {new Date(i.expiresAt).toLocaleString()}</span>
              <Button
                size="sm"
                variant="danger"
                onClick={() => void act(() => api.del(`/admin/invites/${i.id}`))}
              >
                Revoke
              </Button>
            </li>
          ))}
          {invites.data?.length === 0 && <li className="py-2 text-xs text-zinc-500">No pending invites.</li>}
        </ul>
      </Card>

      <Modal title={link?.title ?? ''} open={!!link} onClose={() => setLink(null)}>
        <p className="mb-2 text-xs text-zinc-400">Share this link privately. It works once.</p>
        <Input readOnly value={link?.url ?? ''} onFocus={(e) => e.currentTarget.select()} />
      </Modal>
      {limitsFor && <LimitsDialog user={limitsFor} onClose={() => setLimitsFor(null)} />}
      {toolsFor && <ToolRestrictionsDialog user={toolsFor} onClose={() => setToolsFor(null)} />}
    </div>
  );
}

function CreateUser({
  onLink,
  onDone,
}: {
  onLink: (title: string, url: string) => void;
  onDone: () => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [error, setError] = useState<string | null>(null);

  const invite = async (): Promise<void> => {
    setError(null);
    try {
      const r = await api.post<Invite & { emailed: boolean }>('/admin/invites', { email, role });
      onLink(
        r.emailed ? `Invite emailed to ${email} — link for reference` : `Invite link for ${email}`,
        r.acceptUrl ?? '',
      );
      setEmail('');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const create = async (): Promise<void> => {
    setError(null);
    try {
      const r = await api.post<{ setPasswordUrl: string | null }>('/admin/users', {
        email,
        displayName: name || email.split('@')[0],
        role,
      });
      if (r.setPasswordUrl) onLink(`Set-password link for ${email} (72 h)`, r.setPasswordUrl);
      setEmail('');
      setName('');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Card title="Add a user">
      <div className="grid grid-cols-[2fr_1.5fr_1fr_auto_auto] items-end gap-2">
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Name (for direct create)">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </Select>
        </Field>
        <Button variant="primary" disabled={!email} onClick={() => void invite()}>
          Send invite
        </Button>
        <Button disabled={!email} onClick={() => void create()}>
          Create now
        </Button>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        There is no public sign-up. Invites are emailed when SMTP is configured; otherwise copy the link
        shown.
      </p>
      <ErrorText error={error} />
    </Card>
  );
}

function LimitsDialog({ user, onClose }: { user: AdminUserRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [l, setL] = useState<MemberLimits>(
    user.limits ?? {
      sandboxCpu: 1,
      sandboxMemMb: 2048,
      sandboxDiskMb: 4096,
      maxContainers: 2,
      networkMode: 'egress',
    },
  );
  const [error, setError] = useState<string | null>(null);
  const save = async (reset: boolean): Promise<void> => {
    try {
      if (reset) await api.del(`/admin/users/${user.id}/limits`);
      else await api.put(`/admin/users/${user.id}/limits`, l);
      await qc.invalidateQueries({ queryKey: usersKey });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const num = (k: keyof MemberLimits) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setL({ ...l, [k]: Number(e.target.value) });
  return (
    <Modal title={`Sandbox limits — ${user.email}`} open onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="CPUs">
          <Input type="number" step="0.1" value={l.sandboxCpu} onChange={num('sandboxCpu')} />
        </Field>
        <Field label="Memory (MB)">
          <Input type="number" value={l.sandboxMemMb} onChange={num('sandboxMemMb')} />
        </Field>
        <Field label="Disk per project (MB)">
          <Input type="number" value={l.sandboxDiskMb} onChange={num('sandboxDiskMb')} />
        </Field>
        <Field label="Concurrent sandboxes">
          <Input type="number" value={l.maxContainers} onChange={num('maxContainers')} />
        </Field>
        <Field label="Network">
          <Select
            value={l.networkMode}
            onChange={(e) => setL({ ...l, networkMode: e.target.value as 'egress' | 'none' })}
          >
            <option value="egress">Internet (no host/LAN)</option>
            <option value="none">No network</option>
          </Select>
        </Field>
      </div>
      <p className="mt-2 text-xs text-zinc-500">Running sandboxes pick up new limits on their next start.</p>
      <ErrorText error={error} />
      <div className="mt-3 flex justify-between">
        <Button onClick={() => void save(true)}>Use global defaults</Button>
        <Button variant="primary" onClick={() => void save(false)}>
          Save
        </Button>
      </div>
    </Modal>
  );
}

function ToolRestrictionsDialog({ user, onClose }: { user: AdminUserRow; onClose: () => void }) {
  const tools = useQuery({ queryKey: ['tools'], queryFn: () => api.get<ToolCatalogEntry[]>('/tools') });
  const current = useQuery({
    queryKey: ['admin', 'restrictions', user.id],
    queryFn: () =>
      api.get<{ toolName: string; allowed: boolean }[]>(`/admin/users/${user.id}/tool-restrictions`),
  });
  const [overrides, setOverrides] = useState<Record<string, boolean> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const state = overrides ?? Object.fromEntries((current.data ?? []).map((r) => [r.toolName, r.allowed]));
  const effective = (t: ToolCatalogEntry): boolean => state[t.name] ?? t.source === 'builtin';

  const save = async (): Promise<void> => {
    try {
      const restrictions = (tools.data ?? [])
        .map((t) => ({ toolName: t.name, allowed: effective(t) }))
        .filter((r, i) => r.allowed !== ((tools.data ?? [])[i]?.source === 'builtin'));
      await api.put(`/admin/users/${user.id}/tool-restrictions`, { restrictions });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Modal title={`Tools for ${user.email}`} open onClose={onClose}>
      <p className="mb-3 text-xs text-zinc-400">
        Built-in tools are allowed by default. MCP tools run with your server credentials and are denied
        unless you allow them.
      </p>
      <ul className="flex max-h-80 flex-col gap-1 overflow-auto text-sm">
        {tools.data?.map((t) => (
          <li key={t.name}>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={effective(t)}
                onChange={(e) => setOverrides({ ...state, [t.name]: e.target.checked })}
              />
              <span className="font-mono text-xs">{t.name}</span>
              <Badge>{t.source}</Badge>
            </label>
          </li>
        ))}
      </ul>
      <ErrorText error={error} />
      <div className="mt-3 flex justify-end">
        <Button variant="primary" onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
