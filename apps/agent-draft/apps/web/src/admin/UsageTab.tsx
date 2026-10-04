import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { tokens, usd } from '../lib/format';
import { useUsage } from '../lib/queries';
import { Card, Select, Spinner } from '../components/ui';
import { UsageView } from '../components/UsageView';

interface UserUsage {
  userId: string;
  email: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  blocked: number;
}

export function UsageTab() {
  const [days, setDays] = useState(30);
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const byUser = useQuery({ queryKey: ['admin', 'usage-users', days], queryFn: () => api.get<UserUsage[]>(`/admin/usage/users?from=${encodeURIComponent(from)}`) });
  const [userId, setUserId] = useState('');
  const overall = useUsage('/admin/usage/summary', `from=${encodeURIComponent(from)}${userId ? `&userId=${userId}` : ''}`);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-zinc-400">Period</span>
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>Last 24 h</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={365}>Last year</option>
        </Select>
      </div>
      <Card title="Per user">
        {byUser.isLoading && <Spinner />}
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-zinc-500">
            <tr>
              <th className="py-1">User</th>
              <th>Requests</th>
              <th>Tokens in / out</th>
              <th>Blocked</th>
              <th className="text-right">Estimated cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {byUser.data?.map((u) => (
              <tr key={u.userId} className="cursor-pointer hover:bg-zinc-900" onClick={() => setUserId(u.userId === userId ? '' : u.userId)}>
                <td className="py-1.5">{u.email}</td>
                <td>{u.requests}</td>
                <td>
                  {tokens(u.inputTokens)} / {tokens(u.outputTokens)}
                </td>
                <td>{u.blocked}</td>
                <td className="text-right">{usd(u.estimatedCostUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title={userId ? `Detail — ${byUser.data?.find((u) => u.userId === userId)?.email ?? ''}` : 'Overall'}>
        {overall.isLoading && <Spinner />}
        {overall.data && <UsageView summary={overall.data} />}
      </Card>
    </div>
  );
}
