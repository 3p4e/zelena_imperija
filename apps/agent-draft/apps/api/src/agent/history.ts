import { and, asc, eq, inArray } from 'drizzle-orm';
import type { ChatMessage, ContentPart } from '@agent/providers';
import type { Db } from '../db/client.js';
import { messageParts, messages } from '../db/schema/index.js';

/**
 * Rebuilds the provider-neutral transcript of a conversation from the database.
 * Superseded (regenerated) and errored turns are skipped; unanswered tool calls
 * from a stopped run get a synthetic "cancelled" result so every provider
 * accepts the history.
 */
export async function loadHistory(db: Db, conversationId: string): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.superseded, false),
        inArray(messages.status, ['complete', 'stopped']),
      ),
    )
    .orderBy(asc(messages.seq));
  if (rows.length === 0) return [];
  const parts = await db
    .select()
    .from(messageParts)
    .where(
      inArray(
        messageParts.messageId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(messageParts.seq));
  const byMessage = new Map<string, (typeof parts)[number][]>();
  for (const p of parts) {
    const list = byMessage.get(p.messageId) ?? [];
    list.push(p);
    byMessage.set(p.messageId, list);
  }

  const out: ChatMessage[] = [];
  for (const m of rows) {
    const content: ContentPart[] = [];
    for (const p of byMessage.get(m.id) ?? []) {
      if (p.kind === 'text' && p.text) content.push({ type: 'text', text: p.text });
      else if (p.kind === 'tool_call' && p.toolCallId && p.toolName) {
        // CLI runs store tool activity for display only; it is not replayable to an API model.
        if (m.cliKind) continue;
        content.push({ type: 'tool_call', id: p.toolCallId, name: p.toolName, arguments: p.arguments ?? {} });
      } else if (p.kind === 'tool_result' && p.toolCallId) {
        if (m.cliKind) continue;
        content.push({
          type: 'tool_result',
          toolCallId: p.toolCallId,
          content: p.resultText ?? '',
          isError: p.isError ?? false,
        });
      }
    }
    if (content.length === 0) continue;
    if (m.role === 'user' || m.role === 'assistant' || m.role === 'tool') out.push({ role: m.role, content });
  }
  return repairToolPairs(out);
}

/** Ensures every assistant tool_call is answered by a tool_result in the following tool message. */
export function repairToolPairs(history: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    if (!msg) continue;
    if (msg.role === 'tool') {
      // Drop tool results whose call is not in the preceding assistant message.
      const prev = out[out.length - 1];
      const callIds = new Set(
        prev?.role === 'assistant' ? prev.content.filter((c) => c.type === 'tool_call').map((c) => c.id) : [],
      );
      const kept = msg.content.filter((c) => c.type === 'tool_result' && callIds.has(c.toolCallId));
      if (kept.length > 0) out.push({ role: 'tool', content: kept });
      continue;
    }
    out.push(msg);
    if (msg.role === 'assistant') {
      const calls = msg.content.filter((c) => c.type === 'tool_call');
      if (calls.length === 0) continue;
      const next = history[i + 1];
      const answered = new Set(
        next?.role === 'tool'
          ? next.content.filter((c) => c.type === 'tool_result').map((c) => c.toolCallId)
          : [],
      );
      const missing = calls.filter((c) => !answered.has(c.id));
      if (missing.length > 0 && next?.role !== 'tool') {
        out.push({
          role: 'tool',
          content: missing.map((c) => ({
            type: 'tool_result',
            toolCallId: c.id,
            content: 'Cancelled before execution.',
            isError: true,
          })),
        });
      } else if (missing.length > 0 && next?.role === 'tool') {
        next.content.push(
          ...missing.map((c): ContentPart => ({
            type: 'tool_result',
            toolCallId: c.id,
            content: 'Cancelled before execution.',
            isError: true,
          })),
        );
      }
    }
  }
  return out;
}

/** Drops the oldest turns until the transcript fits a rough character budget (≈3.5 chars/token). */
export function fitToContext(
  history: ChatMessage[],
  contextWindowTokens: number,
  reserveTokens = 16_000,
): ChatMessage[] {
  const budgetChars = Math.max(8_000, (contextWindowTokens - reserveTokens) * 3.5);
  const size = (m: ChatMessage): number =>
    m.content.reduce(
      (n, c) =>
        n +
        (c.type === 'text' || c.type === 'reasoning'
          ? c.text.length
          : c.type === 'tool_result'
            ? c.content.length
            : c.type === 'tool_call'
              ? JSON.stringify(c.arguments).length
              : 1000),
      0,
    );
  let total = history.reduce((n, m) => n + size(m), 0);
  let start = 0;
  while (total > budgetChars && start < history.length - 1) {
    total -= size(history[start] ?? { role: 'user', content: [] });
    start++;
    // Never start on a tool message or an assistant message that answers nothing.
    while (start < history.length - 1 && history[start]?.role !== 'user') {
      total -= size(history[start] ?? { role: 'user', content: [] });
      start++;
    }
  }
  return history.slice(start);
}
