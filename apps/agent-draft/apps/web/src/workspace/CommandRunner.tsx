import { useState } from 'react';
import type { ExecStreamEvent } from '@agent/shared';
import { errorMessage, streamSse } from '../lib/api';
import { Button, Input } from '../components/ui';

/** Runs one command through an SSE endpoint and shows live output. */
export function CommandRunner({ endpoint, placeholder, label, onDone }: { endpoint: string; placeholder: string; label: string; onDone?: () => void }) {
  const [command, setCommand] = useState('');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);

  const run = async (): Promise<void> => {
    if (!command.trim()) return;
    setRunning(true);
    setOutput('');
    try {
      await streamSse<ExecStreamEvent & { executionId?: string }>(endpoint, { command }, (ev) => {
        if (ev.type === 'stdout' || ev.type === 'stderr') setOutput((o) => o + ev.chunk);
        else setOutput((o) => `${o}\n[${ev.timedOut ? 'timed out' : `exit ${ev.exitCode ?? '?'}`}]`);
      });
    } catch (err) {
      setOutput((o) => `${o}\n${errorMessage(err)}`);
    } finally {
      setRunning(false);
      onDone?.();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <Input className="font-mono text-xs" placeholder={placeholder} value={command} onChange={(e) => setCommand(e.target.value)} />
        <Button type="submit" loading={running}>
          {label}
        </Button>
      </form>
      {output && <pre className="max-h-64 overflow-auto rounded bg-zinc-900 p-2 font-mono text-[11.5px] whitespace-pre-wrap">{output}</pre>}
    </div>
  );
}
