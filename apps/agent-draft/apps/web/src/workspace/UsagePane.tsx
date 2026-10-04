import type { Project } from '@agent/shared';
import { errorMessage } from '../lib/api';
import { useUsage } from '../lib/queries';
import { ErrorText, Spinner } from '../components/ui';
import { UsageView } from '../components/UsageView';

export function UsagePane({ project }: { project: Project }) {
  const usage = useUsage('/usage/summary', `projectId=${project.id}`);
  return (
    <div className="h-full overflow-auto p-3">
      {usage.isLoading && <Spinner />}
      {usage.error && <ErrorText error={errorMessage(usage.error)} />}
      {usage.data && <UsageView summary={usage.data} />}
      {project.myPermission !== 'owner' && (
        <p className="mt-3 text-[11px] text-zinc-500">Showing only your own usage in this shared project.</p>
      )}
    </div>
  );
}
