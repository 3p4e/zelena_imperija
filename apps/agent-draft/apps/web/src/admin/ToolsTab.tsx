import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { qk, useTools } from '../lib/queries';
import { Badge, Button, Card, ErrorText } from '../components/ui';

export function ToolsTab() {
  const qc = useQueryClient();
  const tools = useTools();
  const [error, setError] = useState<string | null>(null);
  const toggle = async (name: string, enabled: boolean): Promise<void> => {
    setError(null);
    try {
      await api.patch(`/admin/tools/${encodeURIComponent(name)}`, { enabled });
      await qc.invalidateQueries({ queryKey: qk.tools });
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Card title="Tool registry">
      <p className="mb-3 text-xs text-zinc-400">
        Disabling a tool removes it for every agent and user. Per-member restrictions are set on the Users tab. MCP servers are configured through the admin API in Phase 1 (see README); their tools appear here.
      </p>
      <ErrorText error={error} />
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-zinc-500">
          <tr>
            <th className="py-1">Tool</th>
            <th>Source</th>
            <th>Permission</th>
            <th>Description</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {tools.data?.map((t) => (
            <tr key={t.name} className={t.enabled ? '' : 'opacity-50'}>
              <td className="py-1.5 font-mono text-xs">{t.name}</td>
              <td>
                <Badge tone={t.source === 'mcp' ? 'info' : 'neutral'}>{t.source}</Badge>
              </td>
              <td>
                <Badge tone={t.permission === 'exec' || t.permission === 'network' ? 'warn' : 'neutral'}>{t.permission}</Badge>
              </td>
              <td className="max-w-md truncate text-xs text-zinc-400">{t.description}</td>
              <td className="text-right">
                <Button size="sm" onClick={() => void toggle(t.name, !t.enabled)}>
                  {t.enabled ? 'Disable' : 'Enable'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
