import type { FastifyReply, FastifyRequest } from 'fastify';

export interface SseChannel {
  send: (event: unknown) => void;
  close: () => void;
  readonly closed: boolean;
  onClose: (fn: () => void) => void;
}

/** Takes over the raw response and streams `data: <json>` frames with a heartbeat. */
export function openSse(req: FastifyRequest, reply: FastifyReply): SseChannel {
  reply.hijack();
  const res = reply.raw;
  const origin = req.headers.origin;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    ...(origin
      ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' }
      : {}),
  });
  res.write(': connected\n\n');
  let closed = false;
  const listeners: (() => void)[] = [];
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': ping\n\n');
  }, 15_000);
  const finish = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    for (const l of listeners) l();
  };
  req.raw.on('close', finish);
  return {
    get closed() {
      return closed;
    },
    send(event) {
      if (closed) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    close() {
      if (closed) return;
      finish();
      res.end();
    },
    onClose(fn) {
      listeners.push(fn);
    },
  };
}
