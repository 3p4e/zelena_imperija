import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminUserRow, MemberLimits, ToolCatalogEntry } from '@agent/shared';
import { api, errorMessage } from '../lib/api';
import { relativeTime } from '../lib/format';
import { Badge, Button, Card, ErrorText, Field, Input, Modal, Select } from '../components/ui';

const usersKey = ['admin', 'users'];

export function UsersTab() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: usersKey, queryFn: () => api.get<AdminUserRow[]>('/admin/users') });
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [limitsFor, setLimitsFor] = useState<AdminUserRow | null>(null);
  const [toolsFor, setToolsFor] = useState<AdminUserRow | null>(null);

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: usersKey });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <CreateUser
        onInvite={setInvite}
        onDone={() => {
          void qc.invalidateQueries({ queryKey: usersKey });
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
                  <Badge tone={u.status === 'active' ? 'good' : 'bad'}>{u.status}</Badge>{' '}
                  {u.mustChangePassword && <Badge tone="warn">one-time password</Badge>}
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
                          const r = await api.post<{
                            email: string;
                            temporaryPassword: string;
                            loginUrl: string;
                          }>(`/admin/users/${u.id}/reset-password`);
                          setInvite({ ...r, title: `New one-time password for ${r.email}` });
                        })
                      }
                    >
                      New one-time password
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
      <InviteModal invite={invite} onClose={() => setInvite(null)} />
      {limitsFor && <LimitsDialog user={limitsFor} onClose={() => setLimitsFor(null)} />}
      {toolsFor && <ToolRestrictionsDialog user={toolsFor} onClose={() => setToolsFor(null)} />}
    </div>
  );
}

interface InviteInfo {
  title: string;
  email: string;
  temporaryPassword: string;
  loginUrl: string;
}

export function inviteText(i: Pick<InviteInfo, 'email' | 'temporaryPassword' | 'loginUrl'>): string {
  return [
    'You have been given access to BACK_LOG.',
    '',
    `Sign in: ${i.loginUrl}`,
    `Username: ${i.email}`,
    `One-time password: ${i.temporaryPassword}`,
    '',
    'You will be asked to choose your own password at first sign-in. This one-time password stops working once you do.',
  ].join('\n');
}

function InviteModal({ invite, onClose }: { invite: InviteInfo | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const text = invite ? inviteText(invite) : '';
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked (non-secure context, permissions): fall back to manual copy.
      (document.getElementById('invite-text') as HTMLTextAreaElement | null)?.select();
      setCopyFailed(true);
    }
  };
  return (
    <Modal
      title={invite?.title ?? ''}
      open={!!invite}
      onClose={() => {
        setCopied(false);
        setCopyFailed(false);
        onClose();
      }}
    >
      <p className="mb-2 text-xs text-zinc-400">
        This is the only time the one-time password is shown. Copy it and send it privately.
      </p>
      <textarea
        id="invite-text"
        readOnly
        rows={8}
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded border border-zinc-700 bg-zinc-950 p-2 font-mono text-xs"
      />
      <div className="mt-3 flex items-center justify-end gap-3">
        {copyFailed && (
          <span className="text-xs text-amber-400">Copy blocked — press Ctrl+C on the selected text.</span>
        )}
        <Button variant="primary" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy invite'}
        </Button>
      </div>
    </Modal>
  );
}

function CreateUser({ onInvite, onDone }: { onInvite: (i: InviteInfo) => void; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [error, setError] = useState<string | null>(null);

  const create = async (): Promise<void> => {
    setError(null);
    try {
      const r = await api.post<{ email: string; temporaryPassword: string; loginUrl: string }>(
        '/admin/users',
        { email, displayName: name || email.split('@')[0], role },
      );
      onInvite({ ...r, title: `Invite for ${r.email}` });
      setEmail('');
      setName('');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Card title="Add a user">
      <div className="grid grid-cols-[2fr_1.5fr_1fr_auto] items-end gap-2">
        <Field label="Email (becomes the username)">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Name (optional)">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </Select>
        </Field>
        <Button variant="primary" disabled={!email} onClick={() => void create()}>
          Create &amp; generate invite
        </Button>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        The account is created with a generated one-time password that the user must replace at first sign-in.
        You get a copy button to paste the invite anywhere. There is no public sign-up.
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
