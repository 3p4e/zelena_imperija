import { lazy, Suspense, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Play, Square } from 'lucide-react';
import type { Project } from '@agent/shared';
import { api, errorMessage } from '../lib/api';
import { qk, useSandbox } from '../lib/queries';
import { Badge, Button, ErrorText, Spinner, Tabs } from '../components/ui';
import { TestsPane } from './TestsPane';
import { PreviewPane } from './PreviewPane';
import { ActivityPane } from './ActivityPane';
import { UsagePane } from './UsagePane';

// Monaco and xterm are large; load them only when their tab opens.
const FilesPane = lazy(() => import('./FilesPane').then((m) => ({ default: m.FilesPane })));
const TerminalPane = lazy(() => import('./TerminalPane').then((m) => ({ default: m.TerminalPane })));

type Tab = 'files' | 'terminal' | 'tests' | 'preview' | 'activity' | 'usage';

export function RightPanel({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const [tab, setTab] = useState<Tab>('files');
  const sandbox = useSandbox(project.id);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = sandbox.data?.sandbox?.status ?? 'not created';

  const toggle = async (action: 'start' | 'stop'): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/projects/${project.id}/sandbox/${action}`);
      await qc.invalidateQueries({ queryKey: qk.sandbox(project.id) });
      await qc.invalidateQueries({ queryKey: qk.files(project.id) });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const s = sandbox.data?.sandbox;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 text-xs">
        <span className="text-zinc-400">Sandbox</span>
        <Badge tone={status === 'running' ? 'good' : status === 'failed' ? 'bad' : 'neutral'}>{status}</Badge>
        {s && (
          <span className="text-zinc-500">
            {s.cpu} CPU · {s.memMb} MB RAM · {s.diskMb} MB disk
          </span>
        )}
        {canEdit && (
          <div className="ml-auto">
            {status === 'running' ? (
              <Button size="sm" onClick={() => void toggle('stop')} loading={busy}>
                <Square className="size-3" /> Stop
              </Button>
            ) : (
              <Button size="sm" onClick={() => void toggle('start')} loading={busy}>
                <Play className="size-3" /> Start
              </Button>
            )}
          </div>
        )}
      </div>
      {error && (
        <div className="px-3 pt-2">
          <ErrorText error={error} />
        </div>
      )}
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'files', label: 'Files' },
          { id: 'terminal', label: 'Terminal' },
          { id: 'tests', label: 'Tests' },
          { id: 'preview', label: 'Preview' },
          { id: 'activity', label: 'Activity' },
          { id: 'usage', label: 'Usage' },
        ]}
      />
      <div className="min-h-0 flex-1">
        <Suspense fallback={<Spinner />}>
          {tab === 'files' && <FilesPane project={project} canEdit={canEdit} />}
          {tab === 'terminal' && (canEdit ? <TerminalPane project={project} /> : <p className="p-4 text-sm text-zinc-500">The terminal needs edit access.</p>)}
          {tab === 'tests' && <TestsPane project={project} canEdit={canEdit} />}
          {tab === 'preview' && <PreviewPane project={project} canEdit={canEdit} ports={s?.previewPorts ?? []} />}
          {tab === 'activity' && <ActivityPane project={project} canEdit={canEdit} />}
          {tab === 'usage' && <UsagePane project={project} />}
        </Suspense>
      </div>
    </div>
  );
}
