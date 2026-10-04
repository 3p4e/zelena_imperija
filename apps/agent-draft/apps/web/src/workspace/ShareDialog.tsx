import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Project } from '@agent/shared';
import { api, errorMessage } from '../lib/api';
import { Button, ErrorText, Field, Input, Modal, Select } from '../components/ui';

interface Share {
  userId: string;
  email: string;
  permission: 'read' | 'edit';
}

export function ShareDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const qc = useQueryClient();
  const key = ['shares', project.id];
  const shares = useQuery({
    queryKey: key,
    queryFn: () => api.get<Share[]>(`/projects/${project.id}/shares`),
  });
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'read' | 'edit'>('read');
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Modal title={`Share “${project.name}”`} open onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-xs text-zinc-400">
          Read: see files, chat history and previews. Edit: also chat with the agent, edit files and run
          commands. Sandbox resources count against your limits.
        </p>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.put(`/projects/${project.id}/shares`, { email, permission })).then(() =>
              setEmail(''),
            );
          }}
        >
          <Field label="User email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Select value={permission} onChange={(e) => setPermission(e.target.value as 'read' | 'edit')}>
            <option value="read">Read</option>
            <option value="edit">Edit</option>
          </Select>
          <Button type="submit" variant="primary">
            Share
          </Button>
        </form>
        <ErrorText error={error} />
        <ul className="divide-y divide-zinc-800 rounded border border-zinc-800">
          {(shares.data ?? []).map((s) => (
            <li key={s.userId} className="flex items-center justify-between px-3 py-2">
              <span>{s.email}</span>
              <div className="flex items-center gap-2">
                <Select
                  value={s.permission}
                  onChange={(e) =>
                    void run(() =>
                      api.put(`/projects/${project.id}/shares`, {
                        email: s.email,
                        permission: e.target.value,
                      }),
                    )
                  }
                >
                  <option value="read">Read</option>
                  <option value="edit">Edit</option>
                </Select>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void run(() => api.del(`/projects/${project.id}/shares/${s.userId}`))}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
          {shares.data?.length === 0 && (
            <li className="px-3 py-2 text-xs text-zinc-500">Not shared with anyone.</li>
          )}
        </ul>
      </div>
    </Modal>
  );
}
