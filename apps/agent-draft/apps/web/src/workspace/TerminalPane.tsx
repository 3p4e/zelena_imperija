import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { Project } from '@agent/shared';
import { Button } from '../components/ui';

/** Interactive shell inside the project's sandbox, over a WebSocket. Every session is logged server-side. */
export function TerminalPane({ project }: { project: Project }) {
  const host = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState(0);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');

  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'ui-monospace, Menlo, monospace',
      theme: { background: '#09090b' },
      cursorBlink: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/projects/${project.id}/terminal`);
    setStatus('connecting');
    const sendResize = (): void => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };
    ws.onopen = () => {
      setStatus('open');
      sendResize();
    };
    ws.onmessage = (e) => term.write(typeof e.data === 'string' ? e.data : '');
    ws.onclose = (e) => {
      setStatus('closed');
      term.write(`\r\n\x1b[90m[session closed${e.reason ? `: ${e.reason}` : ''}]\x1b[0m\r\n`);
    };
    const input = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
    });
    const observer = new ResizeObserver(() => {
      fit.fit();
      sendResize();
    });
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      input.dispose();
      ws.close();
      term.dispose();
    };
  }, [project.id, session]);

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1 text-xs text-zinc-500">
        <span>bash in /workspace · {status}</span>
        {status === 'closed' && (
          <Button size="sm" className="ml-auto" onClick={() => setSession((s) => s + 1)}>
            Reconnect
          </Button>
        )}
      </div>
      <div ref={host} className="min-h-0 flex-1 p-1" />
    </div>
  );
}
