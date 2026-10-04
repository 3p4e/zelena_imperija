import type { UsageSummary } from '@agent/shared';
import { tokens, usd } from '../lib/format';
import { Empty } from './ui';

/** Totals, cost per model and a per-day bar list. Costs are estimates from the model registry unless the provider reports exact cost. */
export function UsageView({ summary }: { summary: UsageSummary }) {
  if (summary.requests === 0) return <Empty>No model requests recorded yet.</Empty>;
  const maxDay = Math.max(...summary.byDay.map((d) => d.estimatedCostUsd), 0.000001);
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="grid grid-cols-4 gap-2">
        <Stat label="Requests" value={String(summary.requests)} />
        <Stat label="Input tokens" value={tokens(summary.inputTokens)} />
        <Stat label="Output tokens" value={tokens(summary.outputTokens)} />
        <Stat label="Estimated cost" value={usd(summary.estimatedCostUsd)} />
      </div>
      <table className="w-full text-xs">
        <thead className="text-left text-zinc-500">
          <tr>
            <th className="py-1">Provider / model</th>
            <th>Requests</th>
            <th>In</th>
            <th>Out</th>
            <th className="text-right">Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {summary.byModel.map((m) => (
            <tr key={`${m.providerSlug}/${m.modelId}`}>
              <td className="py-1 font-mono">
                {m.providerSlug}/{m.modelId}
              </td>
              <td>{m.requests}</td>
              <td>{tokens(m.inputTokens)}</td>
              <td>{tokens(m.outputTokens)}</td>
              <td className="text-right">{usd(m.estimatedCostUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-col gap-1">
        {summary.byDay.map((d) => (
          <div key={d.day} className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 text-zinc-500">{d.day}</span>
            <div
              className="h-2 rounded bg-amber-500/70"
              style={{ width: `${Math.max(2, (d.estimatedCostUsd / maxDay) * 100)}%` }}
            />
            <span className="shrink-0 text-zinc-400">
              {usd(d.estimatedCostUsd)} · {d.requests} req
            </span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-zinc-500">Subscription CLI runs record tokens but no cost.</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900 p-2">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}
