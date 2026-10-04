import { useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Brain, ChevronDown, ChevronRight, Loader2, Wrench } from 'lucide-react';
import type { UiMessage, UiPart } from '../lib/chat-state';
import { CLI_LABELS } from '../lib/format';
import { Badge } from '../components/ui';
import { Markdown } from './Markdown';

/**
 * Tool results live in the tool message that follows the assistant message (API runs)
 * or in the same message (CLI runs). Keys are scoped to the owning assistant message so a
 * provider that reuses call ids can never attach a result to the wrong call.
 */
export function resultIndex(messages: UiMessage[]): Map<string, UiPart> {
  const map = new Map<string, UiPart>();
  let owner: string | null = null;
  for (const m of messages) {
    if (m.role === 'assistant') owner = m.id;
    else if (m.role === 'user') owner = null;
    if (!owner) continue;
    for (const p of m.parts)
      if (p.kind === 'tool_result' && p.toolCallId) map.set(`${owner}:${p.toolCallId}`, p);
  }
  return map;
}

export function MessageView({
  message,
  results,
  modelName,
}: {
  message: UiMessage;
  results: Map<string, UiPart>;
  modelName: string | null;
}) {
  if (message.role === 'tool') {
    // CLI runs store results in the assistant message itself; API runs use separate tool messages.
    return null;
  }
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-zinc-800 px-3 py-2 text-sm whitespace-pre-wrap">
          {message.parts.map((p) => p.text).join('')}
        </div>
      </div>
    );
  }
  const label = message.cliKind ? CLI_LABELS[message.cliKind] : modelName;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <span>{label ?? 'assistant'}</span>
        {message.status === 'streaming' && <Loader2 className="size-3 animate-spin" />}
        {message.status === 'stopped' && <Badge tone="warn">stopped</Badge>}
        {message.status === 'error' && <Badge tone="bad">error</Badge>}
      </div>
      {message.parts.map((p) => {
        switch (p.kind) {
          case 'text':
            return p.text ? <Markdown key={p.id} text={p.text} /> : null;
          case 'reasoning':
            return <Reasoning key={p.id} part={p} />;
          case 'tool_call':
            return (
              <ToolCall
                key={p.id}
                call={p}
                result={p.toolCallId ? results.get(`${message.id}:${p.toolCallId}`) : undefined}
              />
            );
          case 'tool_result':
            // Only shown standalone when there is no matching call in view (CLI runs pair them in one message).
            return null;
          case 'error':
            return (
              <div
                key={p.id}
                className="flex items-start gap-2 rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{p.text}</span>
              </div>
            );
        }
      })}
    </div>
  );
}

function Reasoning({ part }: { part: UiPart }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-zinc-800 text-xs text-zinc-400">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 px-2 py-1.5">
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <Brain className="size-3.5" /> Thinking
        {part.streaming && <Loader2 className="size-3 animate-spin" />}
      </button>
      {open && <div className="border-t border-zinc-800 px-3 py-2 whitespace-pre-wrap">{part.text}</div>}
    </div>
  );
}

function ToolCall({ call, result }: { call: UiPart; result: UiPart | undefined }) {
  const [open, setOpen] = useState(false);
  const running = result?.resultText == null;
  const failed = result?.isError === true;
  const args = call.arguments ?? (call.progress ? safeParse(call.progress) : null);
  const summary = summarize(call.toolName ?? '', args);
  return (
    <div className={clsx('rounded-md border text-xs', failed ? 'border-red-900/70' : 'border-zinc-800')}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" />
        )}
        <Wrench className="size-3.5 shrink-0 text-zinc-500" />
        <span className="font-mono text-zinc-200">{call.toolName}</span>
        <span className="truncate text-zinc-500">{summary}</span>
        <span className="ml-auto shrink-0">
          {running ? (
            <Loader2 className="size-3 animate-spin" />
          ) : failed ? (
            <Badge tone="bad">failed</Badge>
          ) : (
            <Badge tone="good">ok</Badge>
          )}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-zinc-800 p-2">
          <div>
            <div className="mb-1 text-[10px] tracking-wide text-zinc-500 uppercase">Arguments</div>
            <pre className="max-h-64 overflow-auto rounded bg-zinc-900 p-2 font-mono text-[11.5px] whitespace-pre-wrap">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>
          {(result?.resultText ?? result?.progress) && (
            <div>
              <div className="mb-1 text-[10px] tracking-wide text-zinc-500 uppercase">
                {result.resultText === null ? 'Output (live)' : 'Result'}
              </div>
              <pre className="max-h-80 overflow-auto rounded bg-zinc-900 p-2 font-mono text-[11.5px] whitespace-pre-wrap">
                {result.resultText ?? result.progress}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function summarize(tool: string, args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, unknown>;
  const pick = a.command ?? a.path ?? a.url ?? a.port ?? a.message ?? a.file_path;
  return typeof pick === 'string' || typeof pick === 'number'
    ? String(pick).slice(0, 120)
    : tool.startsWith('mcp__')
      ? ''
      : '';
}
