import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import type { Execution, Project } from '@agent/shared';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';
import { qk } from '../lib/queries';
import { Badge, Empty, Spinner } from '../components/ui';
import { CommandRunner } from './CommandRunner';

/** Every command run in the sandbox (by the agent, the terminal or this panel), with its full log. */
export function ActivityPane({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const qc = useQueryClient();
  const execs = useQuery({ queryKey: qk.executions(project.id), queryFn: () => api.get<Execution[]>(`/projects/${project.id}/executions`) });
  const [open, setOpen] = useState<string | null>(null);
  const logs = useQuery({
    queryKey: ['logs', open],
    queryFn: () => api.get<{ stream: string; chunk: string }[]>(`/executions/${open ?? ''}/logs`),
    enabled: !!open,
  });

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3">
      {canEdit && (
        <CommandRunner
          endpoint={`/projects/${project.id}/exec`}
          placeholder="Run a command in /workspace"
          label="Run"
          onDone={() => void qc.invalidateQueries({ queryKey: qk.executions(project.id) })}
        />
      )}
      {execs.isLoading && <Spinner />}
      {execs.data?.length === 0 && <Empty>No commands have run yet.</Empty>}
      <ul className="flex flex-col divide-y divide-zinc-800 rounded-md border border-zinc-800 text-xs">
        {execs.data?.map((e) => (
          <li key={e.id}>
            <button className={clsx('flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-zinc-900', open === e.id && 'bg-zinc-900')} onClick={() => setOpen(open === e.id ? null : e.id)}>
              <Badge>{e.kind}</Badge>
              <span className="truncate font-mono text-zinc-300">{e.command}</span>
              <span className="ml-auto shrink-0">
                {e.timedOut ? <Badge tone="warn">timed out</Badge> : e.exitCode === null ? <Badge>—</Badge> : e.exitCode === 0 ? <Badge tone="good">0</Badge> : <Badge tone="bad">{e.exitCode}</Badge>}
              </span>
              <span className="w-20 shrink-0 text-right text-zinc-500">{relativeTime(e.startedAt)}</span>
            </button>
            {open === e.id && (
              <pre className="max-h-72 overflow-auto bg-zinc-950 p-2 font-mono text-[11.5px] whitespace-pre-wrap">
                {logs.isLoading ? 'Loading…' : (logs.data ?? []).map((l) => l.chunk).join('') || '(no output)'}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
