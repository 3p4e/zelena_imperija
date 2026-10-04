import { eq, sql } from 'drizzle-orm';
import type { CliKind, CredentialMode, MessageRole, PartKind } from '@agent/shared';
import type { Db } from '../db/client.js';
import { messageParts, messages } from '../db/schema/index.js';
import type { RunBus } from './bus.js';

const MAX_PROGRESS_CHARS = 50_000;

/** Persists one message and its parts while mirroring every change onto the run bus. */
export class MessageWriter {
  private partSeq = 0;
  private readonly buffers = new Map<string, { kind: PartKind; text: string; progress: number }>();

  private constructor(
    private readonly db: Db,
    private readonly bus: RunBus,
    private readonly conversationId: string,
    readonly messageId: string,
  ) {}

  static async create(
    db: Db,
    bus: RunBus,
    conversationId: string,
    role: MessageRole,
    meta: { modelId?: string | null; credentialMode?: CredentialMode | null; cliKind?: CliKind | null; status?: 'streaming' | 'complete' } = {},
  ): Promise<MessageWriter> {
    const [row] = await db
      .insert(messages)
      .values({
        conversationId,
        role,
        seq: sql`(select coalesce(max(seq), 0) + 1 from messages where conversation_id = ${conversationId})`,
        status: meta.status ?? 'streaming',
        modelId: meta.modelId ?? null,
        credentialMode: meta.credentialMode ?? null,
        cliKind: meta.cliKind ?? null,
      })
      .returning({ id: messages.id });
    if (!row) throw new Error('failed to create message');
    const w = new MessageWriter(db, bus, conversationId, row.id);
    if (role === 'assistant') bus.emit(conversationId, { type: 'message_start', messageId: row.id, conversationId, modelId: meta.modelId ?? null });
    return w;
  }

  async startPart(kind: PartKind, extra: { toolName?: string; toolCallId?: string; arguments?: unknown; text?: string } = {}): Promise<string> {
    const seq = this.partSeq++;
    const [row] = await this.db
      .insert(messageParts)
      .values({
        messageId: this.messageId,
        seq,
        kind,
        text: extra.text ?? (kind === 'text' || kind === 'reasoning' || kind === 'error' ? '' : null),
        toolName: extra.toolName ?? null,
        toolCallId: extra.toolCallId ?? null,
        arguments: extra.arguments === undefined ? null : extra.arguments,
      })
      .returning({ id: messageParts.id });
    if (!row) throw new Error('failed to create part');
    this.buffers.set(row.id, { kind, text: extra.text ?? '', progress: 0 });
    this.bus.emit(this.conversationId, {
      type: 'part_start',
      partId: row.id,
      seq,
      kind,
      ...(extra.toolName ? { toolName: extra.toolName } : {}),
      ...(extra.toolCallId ? { toolCallId: extra.toolCallId } : {}),
    });
    if (extra.text) this.bus.emit(this.conversationId, { type: 'part_delta', partId: row.id, delta: extra.text });
    return row.id;
  }

  delta(partId: string, text: string): void {
    const b = this.buffers.get(partId);
    if (!b) return;
    if (b.kind === 'tool_result') {
      // Live tool output is shown while running but capped; the final result replaces it.
      if (b.progress >= MAX_PROGRESS_CHARS) return;
      b.progress += text.length;
    } else {
      b.text += text;
    }
    this.bus.emit(this.conversationId, { type: 'part_delta', partId, delta: text });
  }

  async endPart(partId: string): Promise<void> {
    const b = this.buffers.get(partId);
    if (!b) return;
    if (b.kind === 'text' || b.kind === 'reasoning' || b.kind === 'error') {
      await this.db.update(messageParts).set({ text: b.text }).where(eq(messageParts.id, partId));
    }
    this.bus.emit(this.conversationId, { type: 'part_end', partId });
  }

  async setArguments(partId: string, args: unknown): Promise<void> {
    await this.db.update(messageParts).set({ arguments: args }).where(eq(messageParts.id, partId));
    this.bus.emit(this.conversationId, { type: 'part_end', partId });
  }

  async finishToolResult(partId: string, toolCallId: string, toolName: string, resultText: string, isError: boolean): Promise<void> {
    await this.db.update(messageParts).set({ resultText, isError }).where(eq(messageParts.id, partId));
    this.bus.emit(this.conversationId, { type: 'tool_result', partId, toolCallId, toolName, resultText, isError });
    this.bus.emit(this.conversationId, { type: 'part_end', partId, isError });
  }

  async errorPart(text: string): Promise<void> {
    const id = await this.startPart('error', { text });
    await this.db.update(messageParts).set({ text }).where(eq(messageParts.id, id));
    this.bus.emit(this.conversationId, { type: 'part_end', partId: id, isError: true });
  }

  /** Flushes any open text buffers (used when a run is stopped mid-stream). */
  async flushOpen(): Promise<void> {
    for (const [id, b] of this.buffers) {
      if (b.kind === 'text' || b.kind === 'reasoning') await this.db.update(messageParts).set({ text: b.text }).where(eq(messageParts.id, id));
    }
  }

  async finish(status: 'complete' | 'stopped' | 'error'): Promise<void> {
    await this.db.update(messages).set({ status }).where(eq(messages.id, this.messageId));
  }
}
