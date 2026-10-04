import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RefreshCw, X } from 'lucide-react';
import type { Project } from '@agent/shared';
import { api, errorMessage } from '../lib/api';
import { qk } from '../lib/queries';
import { Button, Empty, ErrorText, Input, Select } from '../components/ui';

/**
 * Previews are served under a signed /preview/<token>/ URL and rendered in a
 * sandboxed iframe without same-origin rights, so the previewed app cannot act
 * as the logged-in user.
 */
export function PreviewPane({ project, canEdit, ports }: { project: Project; canEdit: boolean; ports: { port: number; label: string }[] }) {
  const qc = useQueryClient();
  const [port, setPort] = useState<number | null>(ports[0]?.port ?? null);
  const [url, setUrl] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [newPort, setNewPort] = useState('');

  useEffect(() => {
    if (port === null && ports[0]) setPort(ports[0].port);
  }, [ports, port]);

  useEffect(() => {
    if (port === null) return;
    setError(null);
    api
      .get<{ url: string }>(`/projects/${project.id}/preview-url?port=${port}`)
      .then((r) => setUrl(r.url))
      .catch((err: unknown) => {
        setUrl(null);
        setError(errorMessage(err));
      });
  }, [project.id, port, nonce]);

  const addPort = async (): Promise<void> => {
    const p = Number(newPort);
    if (!Number.isInteger(p)) return;
    try {
      await api.post(`/projects/${project.id}/preview-ports`, { port: p, label: 'app' });
      await qc.invalidateQueries({ queryKey: qk.sandbox(project.id) });
      setPort(p);
      setNewPort('');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const removePort = async (): Promise<void> => {
    if (port === null) return;
    await api.del(`/projects/${project.id}/preview-ports/${port}`).catch(() => undefined);
    await qc.invalidateQueries({ queryKey: qk.sandbox(project.id) });
    setPort(null);
    setUrl(null);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
        <Select value={port ?? ''} onChange={(e) => setPort(Number(e.target.value))} className="text-xs" aria-label="Preview port">
          {ports.length === 0 && <option value="">No ports</option>}
          {ports.map((p) => (
            <option key={p.port} value={p.port}>
              {p.label} · :{p.port}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="ghost" aria-label="Reload preview" onClick={() => setNonce((n) => n + 1)} disabled={!url}>
          <RefreshCw className="size-3.5" />
        </Button>
        {url && (
          <a href={url} target="_blank" rel="noreferrer noopener" className="text-zinc-400 hover:text-zinc-100" aria-label="Open preview in a new tab">
            <ExternalLink className="size-3.5" />
          </a>
        )}
        {canEdit && port !== null && (
          <Button size="sm" variant="ghost" aria-label="Remove port" onClick={() => void removePort()}>
            <X className="size-3.5" />
          </Button>
        )}
        {canEdit && (
          <form
            className="ml-auto flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              void addPort();
            }}
          >
            <Input className="h-7 w-20 text-xs" placeholder="port" value={newPort} onChange={(e) => setNewPort(e.target.value)} />
            <Button size="sm" type="submit">
              Expose
            </Button>
          </form>
        )}
      </div>
      <ErrorText error={error} />
      {url ? (
        <iframe
          key={`${url}-${nonce}`}
          title="Preview"
          src={url}
          sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads"
          className="min-h-0 w-full flex-1 bg-white"
        />
      ) : (
        <Empty>Ask the agent to start a server and call preview, or expose a port your app listens on (bind to 0.0.0.0).</Empty>
      )}
    </div>
  );
}
