import { describe, expect, it } from 'vitest';
import type { ChatStreamEvent } from '@agent/shared';
import { chatReducer, initialChat, type ChatState } from './chat-state';

const run = (events: ChatStreamEvent[]): ChatState =>
  events.reduce((s, event) => chatReducer(s, { type: 'event', event }), initialChat);

describe('chatReducer', () => {
  it('builds an assistant message with streamed text and a tool call/result', () => {
    const state = run([
      { type: 'conversation_status', status: 'running' },
      { type: 'message_start', messageId: 'm1', conversationId: 'c', role: 'assistant', modelId: null },
      { type: 'part_start', messageId: 'm1', partId: 'p1', seq: 0, kind: 'text' },
      { type: 'part_delta', partId: 'p1', delta: 'Hel' },
      { type: 'part_delta', partId: 'p1', delta: 'lo' },
      { type: 'part_end', partId: 'p1' },
      { type: 'message_end', messageId: 'm1', status: 'complete' },
      { type: 'message_start', messageId: 'm2', conversationId: 'c', role: 'tool', modelId: null },
      {
        type: 'part_start',
        messageId: 'm2',
        partId: 'p2',
        seq: 0,
        kind: 'tool_result',
        toolName: 'fs_read',
        toolCallId: 't1',
      },
      { type: 'part_delta', partId: 'p2', delta: 'live…' },
      {
        type: 'tool_result',
        partId: 'p2',
        toolCallId: 't1',
        toolName: 'fs_read',
        resultText: 'final',
        isError: false,
      },
      { type: 'conversation_status', status: 'idle' },
    ]);
    expect(state.running).toBe(false);
    expect(state.messages[0]).toMatchObject({
      id: 'm1',
      status: 'complete',
      parts: [{ text: 'Hello', streaming: false }],
    });
    expect(state.messages[1]?.parts[0]).toMatchObject({
      resultText: 'final',
      isError: false,
      progress: 'live…',
    });
  });

  it('ignores a duplicate message_start (reconnect replay) and unknown parts', () => {
    const start: ChatStreamEvent = {
      type: 'message_start',
      messageId: 'm1',
      conversationId: 'c',
      role: 'assistant',
      modelId: null,
    };
    const state = run([start, start, { type: 'part_delta', partId: 'ghost', delta: 'x' }]);
    expect(state.messages).toHaveLength(1);
  });
});
