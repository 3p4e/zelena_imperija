import type { ChatStreamEvent } from '@agent/shared';

type Listener = (ev: ChatStreamEvent) => void;

interface RunChannel {
  events: ChatStreamEvent[];
  listeners: Set<Listener>;
  closed: boolean;
  closeListeners: Set<() => void>;
}

/**
 * In-process pub/sub for a conversation's active run. Late subscribers (a
 * reconnecting browser tab) receive the buffered events of the current run.
 */
export class RunBus {
  private readonly channels = new Map<string, RunChannel>();

  open(conversationId: string): void {
    this.channels.set(conversationId, { events: [], listeners: new Set(), closed: false, closeListeners: new Set() });
  }

  emit(conversationId: string, ev: ChatStreamEvent): void {
    const ch = this.channels.get(conversationId);
    if (!ch || ch.closed) return;
    ch.events.push(ev);
    for (const l of ch.listeners) l(ev);
  }

  close(conversationId: string): void {
    const ch = this.channels.get(conversationId);
    if (!ch) return;
    ch.closed = true;
    for (const l of ch.closeListeners) l();
    ch.listeners.clear();
    ch.closeListeners.clear();
    // Keep the buffer briefly for clients that reconnect right after the end.
    setTimeout(() => {
      if (this.channels.get(conversationId) === ch) this.channels.delete(conversationId);
    }, 30_000).unref();
  }

  isActive(conversationId: string): boolean {
    const ch = this.channels.get(conversationId);
    return !!ch && !ch.closed;
  }

  /** Replays buffered events, then streams live ones. Returns an unsubscribe function. */
  subscribe(conversationId: string, listener: Listener, onClose: () => void): () => void {
    const ch = this.channels.get(conversationId);
    if (!ch) {
      onClose();
      return () => undefined;
    }
    for (const ev of ch.events) listener(ev);
    if (ch.closed) {
      onClose();
      return () => undefined;
    }
    ch.listeners.add(listener);
    ch.closeListeners.add(onClose);
    return () => {
      ch.listeners.delete(listener);
      ch.closeListeners.delete(onClose);
    };
  }
}
