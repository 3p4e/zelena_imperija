import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentDefinition, ToolCatalogEntry } from '@agent/shared';
import { api, errorMessage } from '../lib/api';
import { Badge, Button, Card, ErrorText, Field, Input, Modal, Textarea } from '../components/ui';

const key = ['admin', 'agents'];

/** Agents are configuration (role, prompt, model, tools); adding one needs no code. */
export function AgentsTab() {
  const agents = useQuery({ queryKey: key, queryFn: () => api.get<AgentDefinition[]>('/admin/agents') });
  const [editing, setEditing] = useState<AgentDefinition | 'new' | null>(null);
  return (
    <Card
      title="Agents"
      actions={
        <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
          New agent
        </Button>
      }
    >
      <p className="mb-3 text-xs text-zinc-400">
        New conversations use the primary agent. Phase 1 runs one agent per conversation; delegation between
        agents comes in Phase 2.
      </p>
      <ul className="divide-y divide-zinc-800 text-sm">
        {agents.data?.map((a) => (
          <li key={a.id} className="flex items-center gap-3 py-2">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                {a.displayName} <span className="font-mono text-xs text-zinc-500">{a.slug}</span>
                {a.isPrimary && <Badge tone="warn">primary</Badge>}
                {!a.enabled && <Badge tone="bad">disabled</Badge>}
              </div>
              <div className="text-xs text-zinc-500">
                {a.roleDescription} · {a.toolNames.length} tools · max {a.maxIterations} steps
              </div>
            </div>
            <Button size="sm" onClick={() => setEditing(a)}>
              Edit
            </Button>
          </li>
        ))}
      </ul>
      {editing && <AgentDialog agent={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function AgentDialog({ agent, onClose }: { agent: AgentDefinition | null; onClose: () => void }) {
  const qc = useQueryClient();
  const tools = useQuery({ queryKey: ['tools'], queryFn: () => api.get<ToolCatalogEntry[]>('/tools') });
  const [form, setForm] = useState({
    slug: agent?.slug ?? '',
    displayName: agent?.displayName ?? '',
    roleDescription: agent?.roleDescription ?? '',
    systemPrompt: agent?.systemPrompt ?? '',
    maxIterations: String(agent?.maxIterations ?? 40),
    enabled: agent?.enabled ?? true,
    isPrimary: agent?.isPrimary ?? false,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set(agent?.toolNames ?? []));
  const [error, setError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    const body = { ...form, maxIterations: Number(form.maxIterations), toolNames: [...selected] };
    try {
      if (agent) await api.put(`/admin/agents/${agent.id}`, body);
      else await api.post('/admin/agents', body);
      await qc.invalidateQueries({ queryKey: key });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const toggle = (name: string, on: boolean): void => {
    const next = new Set(selected);
    if (on) next.add(name);
    else next.delete(name);
    setSelected(next);
  };

  return (
    <Modal title={agent ? `Edit ${agent.displayName}` : 'New agent'} open onClose={onClose} wide>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Slug">
          <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
        </Field>
        <Field label="Name">
          <Input
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
        </Field>
        <Field label="Max steps per turn">
          <Input
            type="number"
            value={form.maxIterations}
            onChange={(e) => setForm({ ...form, maxIterations: e.target.value })}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-col gap-3">
        <Field label="Role">
          <Input
            value={form.roleDescription}
            onChange={(e) => setForm({ ...form, roleDescription: e.target.value })}
          />
        </Field>
        <Field label="System prompt">
          <Textarea
            rows={10}
            className="font-mono text-xs"
            value={form.systemPrompt}
            onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
          />
        </Field>
        <div>
          <div className="mb-1 text-sm text-zinc-300">Tools</div>
          <div className="grid grid-cols-3 gap-1 rounded border border-zinc-800 p-2 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={selected.has('mcp__*')}
                onChange={(e) => toggle('mcp__*', e.target.checked)}
              />
              <span className="font-mono">mcp__*</span> (all MCP tools)
            </label>
            {tools.data?.map((t) => (
              <label key={t.name} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={selected.has(t.name)}
                  onChange={(e) => toggle(t.name, e.target.checked)}
                />
                <span className="font-mono">{t.name}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />{' '}
            Enabled
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={form.isPrimary}
              onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })}
            />{' '}
            Primary (used for new conversations)
          </label>
        </div>
      </div>
      <ErrorText error={error} />
      <div className="mt-3 flex justify-end">
        <Button variant="primary" onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
