import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Project } from '@agent/shared';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';
import { qk } from '../lib/queries';
import { Badge, Empty, Spinner } from '../components/ui';
import { CommandRunner } from './CommandRunner';

interface TestRunRow {
  id: string;
  framework: string;
  total: number | null;
  passed: number | null;
  failed: number | null;
  summary: string;
  command: string;
  createdAt: string;
}

export function TestsPane({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const qc = useQueryClient();
  const runs = useQuery({
    queryKey: qk.testRuns(project.id),
    queryFn: () => api.get<TestRunRow[]>(`/projects/${project.id}/test-runs`),
  });
  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3">
      {canEdit && (
        <CommandRunner
          endpoint={`/projects/${project.id}/test-runs`}
          placeholder="npm test · pytest -q · go test ./..."
          label="Run tests"
          onDone={() => void qc.invalidateQueries({ queryKey: qk.testRuns(project.id) })}
        />
      )}
      {runs.isLoading && <Spinner />}
      {runs.data?.length === 0 && (
        <Empty>No test runs yet. The agent records them with its test tool, or run them here.</Empty>
      )}
      <ul className="flex flex-col gap-2">
        {runs.data?.map((r) => {
          const ok = r.failed === 0 || (r.failed === null && r.summary.includes('passed'));
          return (
            <li key={r.id} className="rounded-md border border-zinc-800 p-2 text-xs">
              <div className="flex items-center gap-2">
                <Badge tone={ok ? 'good' : 'bad'}>{ok ? 'passed' : 'failed'}</Badge>
                <span className="font-mono text-zinc-300">{r.command}</span>
                <span className="ml-auto text-zinc-500">{relativeTime(r.createdAt)}</span>
              </div>
              <div className="mt-1 text-zinc-400">
                {r.total !== null
                  ? `${r.passed ?? 0} passed · ${r.failed ?? 0} failed · ${r.total} total (${r.framework})`
                  : r.summary}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
