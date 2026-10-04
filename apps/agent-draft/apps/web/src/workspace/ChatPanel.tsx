import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Send, Square } from 'lucide-react';
import type { ChatStreamEvent, Conversation, Message, Project } from '@agent/shared';
import { api, errorMessage, streamSse } from '../lib/api';
import { chatReducer, initialChat } from '../lib/chat-state';
import { qk, useModels } from '../lib/queries';
import { usd } from '../lib/format';
import { Button, ErrorText, Spinner, Textarea } from '../components/ui';
import { MessageView, resultIndex } from './MessageView';
import { EMPTY_SELECTION, ModelPicker, type Selection } from './ModelPicker';

interface MessagesResponse {
  conversation: Conversation;
  running: boolean;
  messages: Message[];
}

export function ChatPanel({ project, conversation, canEdit }: { project: Project; conversation: Conversation; canEdit: boolean }) {
  const qc = useQueryClient();
  const models = useModels();
  const [state, dispatch] = useReducer(chatReducer, initialChat);
  const [input, setInput] = useState('');
  const [override, setOverride] = useState<Selection>(EMPTY_SELECTION);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const streamAbort = useRef<AbortController | null>(null);

  const history = useQuery({
    queryKey: qk.messages(conversation.id),
    queryFn: () => api.get<MessagesResponse>(`/conversations/${conversation.id}/messages`),
  });

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: qk.messages(conversation.id) });
    await qc.invalidateQueries({ queryKey: qk.conversations(project.id) });
    await qc.invalidateQueries({ queryKey: ['usage'] });
    await qc.invalidateQueries({ queryKey: qk.files(project.id) });
    await qc.invalidateQueries({ queryKey: qk.sandbox(project.id) });
    await qc.invalidateQueries({ queryKey: qk.testRuns(project.id) });
    await qc.invalidateQueries({ queryKey: qk.executions(project.id) });
  }, [qc, conversation.id, project.id]);

  const follow = useCallback(
    async (path: string, body: unknown) => {
      streamAbort.current?.abort();
      const controller = new AbortController();
      streamAbort.current = controller;
      try {
        await streamSse<ChatStreamEvent>(path, body, (event) => dispatch({ type: 'event', event }), controller.signal);
      } finally {
        if (streamAbort.current === controller) streamAbort.current = null;
        await refresh();
      }
    },
    [refresh],
  );

  // Load history; if a run is still going (another tab, page reload), re-attach to it.
  useEffect(() => {
    if (!history.data) return;
    dispatch({ type: 'load', messages: history.data.messages, running: history.data.running });
    if (history.data.running && !streamAbort.current) void follow(`/conversations/${conversation.id}/events`, null).catch(() => undefined);
  }, [history.data, conversation.id, follow]);

  useEffect(() => () => streamAbort.current?.abort(), []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [state.messages]);

  const results = useMemo(() => resultIndex(state.messages), [state.messages]);
  const modelNames = useMemo(() => new Map((models.data ?? []).map((o) => [o.model.id, o.model.displayName])), [models.data]);

  const selectionBody = (s: Selection): Record<string, unknown> =>
    s.modelId || s.credentialMode ? { modelId: s.modelId, credentialMode: s.credentialMode, cliKind: s.cliKind } : {};

  const send = async (): Promise<void> => {
    const content = input.trim();
    if (!content) return;
    setError(null);
    setInput('');
    try {
      await follow(`/conversations/${conversation.id}/messages`, { content, ...selectionBody(override) });
    } catch (err) {
      setError(errorMessage(err));
      setInput(content);
    }
  };

  const regenerate = async (): Promise<void> => {
    setError(null);
    try {
      await follow(`/conversations/${conversation.id}/regenerate`, selectionBody(override));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const stop = async (): Promise<void> => {
    try {
      await api.post(`/conversations/${conversation.id}/stop`);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const setConversationModel = async (s: Selection): Promise<void> => {
    setError(null);
    try {
      await api.patch(`/conversations/${conversation.id}`, { modelId: s.modelId, credentialMode: s.credentialMode, cliKind: s.cliKind });
      await qc.invalidateQueries({ queryKey: qk.conversations(project.id) });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const lastAssistant = [...state.messages].reverse().find((m) => m.role === 'assistant');
  const lastFailed = lastAssistant?.status === 'error' || lastAssistant?.status === 'stopped';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{conversation.title}</h2>
        <ModelPicker
          value={{ modelId: conversation.modelId, credentialMode: conversation.credentialMode, cliKind: conversation.cliKind }}
          onChange={(s) => void setConversationModel(s)}
          inheritLabel="Project / default model"
          disabled={!canEdit || state.running}
        />
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {history.isLoading ? (
          <Spinner />
        ) : state.messages.length === 0 ? (
          <div className="mx-auto mt-16 max-w-md text-center text-sm text-zinc-500">
            Describe what to build. The agent plans, edits files in the sandbox, runs and tests them, and shows the result in Preview.
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {state.messages.map((m) => (
              <MessageView key={m.id} message={m} results={results} modelName={m.modelId ? (modelNames.get(m.modelId) ?? null) : null} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-zinc-800 p-3">
        <ErrorText error={error} />
        {canEdit ? (
          <form
            className="mx-auto flex max-w-3xl flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <Textarea
              rows={3}
              value={input}
              placeholder={state.running ? 'The agent is working…' : 'Message the agent (Enter to send, Shift+Enter for a new line)'}
              disabled={state.running}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">This message:</span>
              <ModelPicker value={override} onChange={setOverride} inheritLabel="Conversation model" disabled={state.running} />
              {state.lastUsage && (
                <span className="text-[11px] text-zinc-500">
                  last step {state.lastUsage.inputTokens}→{state.lastUsage.outputTokens} tok · {usd(state.lastUsage.estimatedCostUsd)}
                </span>
              )}
              <div className="ml-auto flex gap-2">
                {!state.running && lastAssistant && (
                  <Button type="button" size="sm" onClick={() => void regenerate()}>
                    <RotateCcw className="size-3.5" /> {lastFailed ? 'Retry' : 'Regenerate'}
                  </Button>
                )}
                {state.running ? (
                  <Button type="button" size="sm" variant="danger" onClick={() => void stop()}>
                    <Square className="size-3.5" /> Stop
                  </Button>
                ) : (
                  <Button type="submit" size="sm" variant="primary" disabled={!input.trim()}>
                    <Send className="size-3.5" /> Send
                  </Button>
                )}
              </div>
            </div>
          </form>
        ) : (
          <p className="text-center text-xs text-zinc-500">You have read-only access to this project.</p>
        )}
      </div>
    </div>
  );
}
