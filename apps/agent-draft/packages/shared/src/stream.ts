import type { MessageRole, PartKind } from './enums.js';

/**
 * Server-sent events emitted while an assistant message streams.
 * The web client renders these; they are also what the CLI runner
 * normalises vendor CLI output into.
 */
export type ChatStreamEvent =
  | {
      type: 'message_start';
      messageId: string;
      conversationId: string;
      role: MessageRole;
      modelId: string | null;
    }
  | {
      type: 'part_start';
      messageId: string;
      partId: string;
      seq: number;
      kind: PartKind;
      toolName?: string;
      toolCallId?: string;
    }
  | { type: 'part_delta'; partId: string; delta: string }
  | { type: 'part_end'; partId: string; isError?: boolean }
  | {
      type: 'tool_result';
      partId: string;
      toolCallId: string;
      toolName: string;
      resultText: string;
      isError: boolean;
    }
  | {
      type: 'usage';
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens: number;
      estimatedCostUsd: number | null;
    }
  | {
      type: 'message_end';
      messageId: string;
      status: 'complete' | 'stopped' | 'error';
      errorCode?: string;
      errorMessage?: string;
    }
  | { type: 'conversation_status'; status: 'idle' | 'running' | 'stopped' | 'error' };

export type ExecStreamEvent =
  | { type: 'stdout'; chunk: string }
  | { type: 'stderr'; chunk: string }
  | { type: 'exit'; exitCode: number | null; timedOut: boolean };
