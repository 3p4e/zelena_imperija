import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PROVIDER_KINDS, type Model, type Provider } from '@agent/shared';
import { api, errorMessage } from '../lib/api';
import { relativeTime } from '../lib/format';
import { Badge, Button, Card, ErrorText, Field, Input, Modal, Select } from '../components/ui';

const providersKey = ['admin', 'providers'];
const modelsKey = ['admin', 'models'];

export function ModelsTab() {
  const qc = useQueryClient();
  const providers = useQuery({
    queryKey: providersKey,
    queryFn: () => api.get<Provider[]>('/admin/providers'),
  });
  const models = useQuery({ queryKey: modelsKey, queryFn: () => api.get<Model[]>('/admin/models') });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [addingProvider, setAddingProvider] = useState(false);
  const [editModel, setEditModel] = useState<Model | { providerId: string } | null>(null);
  const [filter, setFilter] = useState('');

  const refresh = async (): Promise<void> => {
    await qc.invalidateQueries({ queryKey: providersKey });
    await qc.invalidateQueries({ queryKey: modelsKey });
    await qc.invalidateQueries({ queryKey: ['models'] });
  };
  const act = async (id: string, fn: () => Promise<unknown>): Promise<void> => {
    setError(null);
    setInfo(null);
    setBusy(id);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Providers"
        actions={
          <Button size="sm" variant="primary" onClick={() => setAddingProvider(true)}>
            Add provider
          </Button>
        }
      >
        <ErrorText error={error} />
        {info && <p className="mb-2 text-xs text-emerald-400">{info}</p>}
        {(['featured', 'cloud', 'local'] as const).map((cat) => {
          const inCat = (providers.data ?? []).filter((p) => p.category === cat);
          if (inCat.length === 0) return null;
          return (
            <div key={cat} className="mb-2">
              <div className="mt-2 mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                {cat}
              </div>
              <ul className="divide-y divide-zinc-800 text-sm">
                {inCat.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-2">
                    <div className="flex-1">
                      <div>
                        {p.displayName} <span className="text-xs text-zinc-500">({p.kind})</span>
                      </div>
                      {p.baseUrl && <div className="font-mono text-xs text-zinc-500">{p.baseUrl}</div>}
                    </div>
                    <Badge tone={p.enabled ? 'good' : 'neutral'}>{p.enabled ? 'enabled' : 'disabled'}</Badge>
                    <Button
                      size="sm"
                      loading={busy === p.id}
                      onClick={() =>
                        void act(p.id, async () => {
                          const r = await api.post<{
                            added: number;
                            updated: number;
                            retired: number;
                            total: number;
                          }>(`/admin/providers/${p.id}/refresh-models`);
                          setInfo(
                            `${p.displayName}: ${r.total} models listed · ${r.added} added · ${r.retired} marked unavailable.`,
                          );
                        })
                      }
                    >
                      Refresh models
                    </Button>
                    <Button size="sm" onClick={() => setEditModel({ providerId: p.id })}>
                      Add model
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        void act(`t${p.id}`, () =>
                          api.patch(`/admin/providers/${p.id}`, { enabled: !p.enabled }),
                        )
                      }
                    >
                      {p.enabled ? 'Disable' : 'Enable'}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        <p className="mt-2 text-xs text-zinc-500">
          Refreshing uses your own key for that provider. Only OpenRouter publishes prices through its API;
          set others by hand.
        </p>
      </Card>

      <Card
        title="Model registry"
        actions={
          <Input
            className="h-7 w-56 text-xs"
            placeholder="Filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        }
      >
        <table className="w-full text-xs">
          <thead className="text-left text-zinc-500">
            <tr>
              <th className="py-1">Model</th>
              <th>Context</th>
              <th>$ in / out per Mtok</th>
              <th>Capabilities</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {models.data
              ?.filter(
                (m) =>
                  !filter ||
                  `${m.providerSlug}/${m.modelId} ${m.displayName}`
                    .toLowerCase()
                    .includes(filter.toLowerCase()),
              )
              .map((m) => (
                <tr key={m.id} className={!m.available || m.hidden ? 'opacity-50' : ''}>
                  <td className="py-1.5">
                    <div>
                      {m.favorite && <span title="Favourite">★ </span>}
                      {m.displayName}
                    </div>
                    <div className="font-mono text-zinc-500">
                      {m.providerSlug}/{m.modelId}
                    </div>
                  </td>
                  <td>{m.contextWindow.toLocaleString()}</td>
                  <td>
                    {m.inputPricePerMtok ?? '?'} / {m.outputPricePerMtok ?? '?'}
                  </td>
                  <td className="space-x-1">
                    {m.supportsTools && <Badge>tools</Badge>}
                    {m.supportsVision && <Badge>vision</Badge>}
                    {m.supportsReasoning && <Badge>reasoning</Badge>}
                  </td>
                  <td>
                    {m.source}
                    {m.lastFetchedAt && <div className="text-zinc-500">{relativeTime(m.lastFetchedAt)}</div>}
                  </td>
                  <td className="space-x-1 text-right whitespace-nowrap">
                    <Button
                      size="sm"
                      title={m.favorite ? 'Unfavourite' : 'Favourite (pin to top of picker)'}
                      onClick={() =>
                        void act(`f${m.id}`, () =>
                          api.patch(`/admin/models/${m.id}`, { favorite: !m.favorite }),
                        )
                      }
                    >
                      {m.favorite ? '★' : '☆'}
                    </Button>
                    <Button
                      size="sm"
                      title={m.hidden ? 'Show in chat picker' : 'Hide from chat picker'}
                      onClick={() =>
                        void act(`h${m.id}`, () => api.patch(`/admin/models/${m.id}`, { hidden: !m.hidden }))
                      }
                    >
                      {m.hidden ? 'Hidden' : 'Shown'}
                    </Button>
                    <Button size="sm" onClick={() => setEditModel(m)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>

      {addingProvider && (
        <ProviderDialog onClose={() => setAddingProvider(false)} onSaved={() => void refresh()} />
      )}
      {editModel && (
        <ModelDialog target={editModel} onClose={() => setEditModel(null)} onSaved={() => void refresh()} />
      )}
    </div>
  );
}

function ProviderDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<string>('openai_compatible');
  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    try {
      await api.post('/admin/providers', { kind, slug, displayName, baseUrl: baseUrl || null });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Modal title="Add provider" open onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field
          label="Kind"
          hint="Use OpenAI-compatible for DeepSeek, Mistral, xAI, Ollama, LM Studio and similar."
        >
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {PROVIDER_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Slug" hint="Lowercase id, e.g. deepseek or ollama.">
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <Field label="Display name">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field
          label="Base URL"
          hint="e.g. https://api.deepseek.com/v1 or http://host.docker.internal:11434/v1"
        >
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </Field>
        <ErrorText error={error} />
        <Button variant="primary" onClick={() => void save()}>
          Add
        </Button>
      </div>
    </Modal>
  );
}

function ModelDialog({
  target,
  onClose,
  onSaved,
}: {
  target: Model | { providerId: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = 'id' in target ? target : null;
  const [form, setForm] = useState({
    modelId: existing?.modelId ?? '',
    displayName: existing?.displayName ?? '',
    contextWindow: String(existing?.contextWindow ?? 128000),
    inputPricePerMtok: existing?.inputPricePerMtok?.toString() ?? '',
    outputPricePerMtok: existing?.outputPricePerMtok?.toString() ?? '',
    cachedInputPricePerMtok: existing?.cachedInputPricePerMtok?.toString() ?? '',
    supportsTools: existing?.supportsTools ?? true,
    supportsVision: existing?.supportsVision ?? false,
    supportsReasoning: existing?.supportsReasoning ?? false,
    available: existing?.available ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const price = (v: string): number | null => (v.trim() === '' ? null : Number(v));
  const save = async (): Promise<void> => {
    const body = {
      displayName: form.displayName,
      contextWindow: Number(form.contextWindow),
      inputPricePerMtok: price(form.inputPricePerMtok),
      outputPricePerMtok: price(form.outputPricePerMtok),
      cachedInputPricePerMtok: price(form.cachedInputPricePerMtok),
      supportsTools: form.supportsTools,
      supportsVision: form.supportsVision,
      supportsReasoning: form.supportsReasoning,
      available: form.available,
    };
    try {
      if (existing) await api.patch(`/admin/models/${existing.id}`, body);
      else await api.post(`/admin/providers/${target.providerId}/models`, { ...body, modelId: form.modelId });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const text = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });
  const check = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.checked });
  return (
    <Modal title={existing ? `Edit ${existing.displayName}` : 'Add model'} open onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Model id">
          <Input value={form.modelId} disabled={!!existing} onChange={text('modelId')} />
        </Field>
        <Field label="Display name">
          <Input value={form.displayName} onChange={text('displayName')} />
        </Field>
        <Field label="Context window">
          <Input type="number" value={form.contextWindow} onChange={text('contextWindow')} />
        </Field>
        <Field label="Cached input $/Mtok">
          <Input
            type="number"
            step="any"
            value={form.cachedInputPricePerMtok}
            onChange={text('cachedInputPricePerMtok')}
          />
        </Field>
        <Field label="Input $/Mtok">
          <Input
            type="number"
            step="any"
            value={form.inputPricePerMtok}
            onChange={text('inputPricePerMtok')}
          />
        </Field>
        <Field label="Output $/Mtok">
          <Input
            type="number"
            step="any"
            value={form.outputPricePerMtok}
            onChange={text('outputPricePerMtok')}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        {(['supportsTools', 'supportsVision', 'supportsReasoning', 'available'] as const).map((k) => (
          <label key={k} className="flex items-center gap-1.5">
            <input type="checkbox" checked={form[k]} onChange={check(k)} />
            {k.replace('supports', '').toLowerCase()}
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Leave prices empty when unknown; usage cost then shows as unknown, and members cannot use the model on
        a shared key until it has a price.
      </p>
      <ErrorText error={error} />
      <div className="mt-3 flex justify-end">
        <Button variant="primary" onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
