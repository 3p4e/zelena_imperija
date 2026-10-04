import type { ChatStreamEvent, Message, MessagePart } from '@agent/shared';

/** A part as shown in the UI: server data plus live tool output while it runs. */
export type UiPart = MessagePart & { progress?: string; streaming?: boolean };
export type UiMessage = Omit<Message, 'parts'> & { parts: UiPart[] };

export interface ChatState {
  messages: UiMessage[];
  running: boolean;
  lastUsage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number | null } | null;
}

export const initialChat: ChatState = { messages: [], running: false, lastUsage: null };

export type ChatAction =
  { type: 'load'; messages: Message[]; running: boolean } | { type: 'event'; event: ChatStreamEvent };

function mapPart(messages: UiMessage[], partId: string, fn: (p: UiPart) => UiPart): UiMessage[] {
  return messages.map((m) =>
    m.parts.some((p) => p.id === partId)
      ? { ...m, parts: m.parts.map((p) => (p.id === partId ? fn(p) : p)) }
      : m,
  );
}

/** Applies server events to the transcript; the server stays authoritative and is re-fetched after each run. */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  if (action.type === 'load') return { ...state, messages: action.messages, running: action.running };
  const ev = action.event;
  switch (ev.type) {
    case 'message_start':
      if (state.messages.some((m) => m.id === ev.messageId)) return state;
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: ev.messageId,
            conversationId: ev.conversationId,
            role: ev.role,
            seq: (state.messages.at(-1)?.seq ?? 0) + 1,
            status: ev.role === 'assistant' ? 'streaming' : 'complete',
            modelId: ev.modelId,
            credentialMode: null,
            cliKind: null,
            parts: [],
            createdAt: new Date().toISOString(),
          },
        ],
      };
    case 'part_start':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === ev.messageId
            ? {
                ...m,
                parts: [
                  ...m.parts,
                  {
                    id: ev.partId,
                    seq: ev.seq,
                    kind: ev.kind,
                    text: ev.kind === 'text' || ev.kind === 'reasoning' || ev.kind === 'error' ? '' : null,
                    toolName: ev.toolName ?? null,
                    toolCallId: ev.toolCallId ?? null,
                    arguments: null,
                    resultText: null,
                    isError: null,
                    streaming: true,
                  },
                ],
              }
            : m,
        ),
      };
    case 'part_delta':
      return {
        ...state,
        messages: mapPart(state.messages, ev.partId, (p) =>
          p.kind === 'tool_result' || p.kind === 'tool_call'
            ? { ...p, progress: (p.progress ?? '') + ev.delta }
            : { ...p, text: (p.text ?? '') + ev.delta },
        ),
      };
    case 'part_end':
      return { ...state, messages: mapPart(state.messages, ev.partId, (p) => ({ ...p, streaming: false })) };
    case 'tool_result':
      return {
        ...state,
        messages: mapPart(state.messages, ev.partId, (p) => ({
          ...p,
          resultText: ev.resultText,
          isError: ev.isError,
          streaming: false,
        })),
      };
    case 'usage':
      return {
        ...state,
        lastUsage: {
          inputTokens: ev.inputTokens,
          outputTokens: ev.outputTokens,
          estimatedCostUsd: ev.estimatedCostUsd,
        },
      };
    case 'message_end':
      return {
        ...state,
        messages: state.messages.map((m) => (m.id === ev.messageId ? { ...m, status: ev.status } : m)),
      };
    case 'conversation_status':
      return { ...state, running: ev.status === 'running' };
  }
}
