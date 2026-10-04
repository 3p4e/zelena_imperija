import type { CliKind } from '@agent/shared';

export type CliEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; content: string; isError: boolean };

export interface CliRunState {
  sessionId: string | null;
  model: string | null;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
  /** Set when the CLI reported a terminal failure. */
  errorMessage: string | null;
  finished: boolean;
}

export function newRunState(): CliRunState {
  return { sessionId: null, model: null, usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, errorMessage: null, finished: false };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Converts one line of a vendor CLI's JSONL output into normalised events.
 * Unknown lines are ignored so new vendor event types never break a run.
 */
export type CliLineParser = (line: Obj, state: CliRunState, toolNames: Map<string, string>) => CliEvent[];

/** Claude Code: `claude -p … --output-format stream-json --verbose`. */
export const parseClaudeLine: CliLineParser = (line, state, toolNames) => {
  const out: CliEvent[] = [];
  const type = str(line.type);
  if (type === 'system' && line.subtype === 'init') {
    state.sessionId = str(line.session_id) ?? state.sessionId;
    state.model = str(line.model) ?? state.model;
  } else if ((type === 'assistant' || type === 'user') && isObj(line.message)) {
    if (line.parent_tool_use_id) return out; // subagent internals are not shown
    const content = Array.isArray(line.message.content) ? line.message.content : [];
    for (const block of content) {
      if (!isObj(block)) continue;
      if (block.type === 'text' && type === 'assistant') {
        const t = str(block.text);
        if (t) out.push({ type: 'text', text: t });
      } else if (block.type === 'tool_use') {
        const id = str(block.id) ?? `tool_${toolNames.size}`;
        const name = str(block.name) ?? 'tool';
        toolNames.set(id, name);
        out.push({ type: 'tool_call', id, name, input: block.input ?? {} });
      } else if (block.type === 'tool_result') {
        const id = str(block.tool_use_id) ?? '';
        out.push({ type: 'tool_result', id, name: toolNames.get(id) ?? 'tool', content: flattenContent(block.content), isError: block.is_error === true });
      }
    }
  } else if (type === 'result') {
    state.finished = true;
    state.sessionId = str(line.session_id) ?? state.sessionId;
    if (isObj(line.usage)) {
      state.usage = {
        inputTokens: num(line.usage.input_tokens) + num(line.usage.cache_creation_input_tokens),
        outputTokens: num(line.usage.output_tokens),
        cachedInputTokens: num(line.usage.cache_read_input_tokens),
      };
    }
    if (line.is_error === true || (str(line.subtype) ?? 'success') !== 'success') {
      state.errorMessage = str(line.result) ?? `Claude Code ended with ${str(line.subtype) ?? 'an error'}.`;
    }
  }
  return out;
};

/** Codex CLI: `codex exec --json …`. */
export const parseCodexLine: CliLineParser = (line, state, toolNames) => {
  const out: CliEvent[] = [];
  const type = str(line.type);
  if (type === 'thread.started') {
    state.sessionId = str(line.thread_id) ?? state.sessionId;
  } else if (type === 'turn.completed') {
    state.finished = true;
    if (isObj(line.usage)) {
      state.usage.inputTokens += num(line.usage.input_tokens);
      state.usage.outputTokens += num(line.usage.output_tokens);
      state.usage.cachedInputTokens += num(line.usage.cached_input_tokens);
    }
  } else if (type === 'turn.failed') {
    state.finished = true;
    state.errorMessage = isObj(line.error) ? (str(line.error.message) ?? 'Codex turn failed.') : 'Codex turn failed.';
  } else if (type === 'error') {
    state.errorMessage = str(line.message) ?? 'Codex reported an error.';
  } else if ((type === 'item.started' || type === 'item.completed') && isObj(line.item)) {
    const item = line.item;
    const id = str(item.id) ?? `item_${toolNames.size}`;
    const itemType = str(item.type);
    if (itemType === 'agent_message' && type === 'item.completed') {
      const t = str(item.text);
      if (t) out.push({ type: 'text', text: t });
    } else if (itemType === 'command_execution') {
      if (type === 'item.started') {
        toolNames.set(id, 'shell');
        out.push({ type: 'tool_call', id, name: 'shell', input: { command: str(item.command) ?? '' } });
      } else {
        if (!toolNames.has(id)) {
          toolNames.set(id, 'shell');
          out.push({ type: 'tool_call', id, name: 'shell', input: { command: str(item.command) ?? '' } });
        }
        const exit = typeof item.exit_code === 'number' ? item.exit_code : null;
        out.push({
          type: 'tool_result',
          id,
          name: 'shell',
          content: `${(str(item.aggregated_output) ?? '').trimEnd()}\n[exit code ${exit ?? 'unknown'}]`.trim(),
          isError: exit !== 0 || item.status === 'failed',
        });
      }
    } else if ((itemType === 'file_change' || itemType === 'mcp_tool_call' || itemType === 'web_search') && type === 'item.completed') {
      const name = itemType === 'mcp_tool_call' ? `${str(item.server) ?? 'mcp'}.${str(item.tool) ?? 'tool'}` : itemType;
      const input = itemType === 'file_change' ? { changes: item.changes } : itemType === 'mcp_tool_call' ? item.arguments : { query: item.query };
      toolNames.set(id, name);
      out.push({ type: 'tool_call', id, name, input: input ?? {} });
      const result = itemType === 'mcp_tool_call' ? (item.error ?? item.result) : itemType === 'file_change' ? item.changes : (item.query ?? '');
      out.push({ type: 'tool_result', id, name, content: typeof result === 'string' ? result : JSON.stringify(result ?? {}), isError: item.status === 'failed' || !!item.error });
    }
  }
  return out;
};

/** Gemini CLI: `gemini -p … --output-format stream-json`. */
export const parseGeminiLine: CliLineParser = (line, state, toolNames) => {
  const out: CliEvent[] = [];
  const type = str(line.type);
  if (type === 'init') {
    state.sessionId = str(line.session_id) ?? state.sessionId;
    state.model = str(line.model) ?? state.model;
  } else if (type === 'message' && line.role === 'assistant') {
    const t = str(line.content);
    if (t) out.push({ type: 'text', text: t });
  } else if (type === 'tool_use') {
    const id = str(line.tool_id) ?? `tool_${toolNames.size}`;
    const name = str(line.tool_name) ?? 'tool';
    toolNames.set(id, name);
    out.push({ type: 'tool_call', id, name, input: line.parameters ?? {} });
  } else if (type === 'tool_result') {
    const id = str(line.tool_id) ?? '';
    const isError = line.status === 'error';
    const err = isObj(line.error) ? str(line.error.message) : null;
    out.push({ type: 'tool_result', id, name: toolNames.get(id) ?? 'tool', content: str(line.output) ?? err ?? '', isError });
  } else if (type === 'result') {
    state.finished = true;
    if (isObj(line.stats)) {
      state.usage.inputTokens = num(line.stats.input_tokens);
      state.usage.outputTokens = num(line.stats.output_tokens);
      state.usage.cachedInputTokens = num(line.stats.cached);
    }
    if (line.status === 'error') state.errorMessage = isObj(line.error) ? (str(line.error.message) ?? 'Gemini CLI failed.') : 'Gemini CLI failed.';
  }
  return out;
};

export const PARSERS: Record<CliKind, CliLineParser> = {
  claude_code: parseClaudeLine,
  codex: parseCodexLine,
  gemini_cli: parseGeminiLine,
};

function flattenContent(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (isObj(x) && typeof x.text === 'string' ? x.text : '')).join('\n');
  return '';
}

/** Splits a byte stream into JSON objects, one per line, tolerating partial lines and noise. */
export class JsonLineSplitter {
  private buffer = '';

  push(chunk: string): Obj[] {
    this.buffer += chunk;
    const out: Obj[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      const parsed = parseLine(line);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  end(): Obj[] {
    const parsed = parseLine(this.buffer.trim());
    this.buffer = '';
    return parsed ? [parsed] : [];
  }
}

function parseLine(line: string): Obj | null {
  if (!line.startsWith('{')) return null;
  try {
    const v: unknown = JSON.parse(line);
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

/** The argv for each CLI. All binaries are run unmodified, as published by their vendors. */
export function cliArgv(kind: CliKind, prompt: string, resumeSessionId: string | null): string[] {
  switch (kind) {
    case 'claude_code':
      return [
        'claude',
        '-p',
        prompt,
        '--output-format',
        'stream-json',
        '--verbose',
        '--dangerously-skip-permissions',
        ...(resumeSessionId ? ['--resume', resumeSessionId] : []),
      ];
    case 'codex':
      return [
        'codex',
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--dangerously-bypass-approvals-and-sandbox',
        ...(resumeSessionId ? ['resume', resumeSessionId, prompt] : ['-C', '/workspace', prompt]),
      ];
    case 'gemini_cli':
      return ['gemini', '-p', prompt, '--output-format', 'stream-json', '--yolo', ...(resumeSessionId ? ['--resume', resumeSessionId] : [])];
  }
}

/** Presence of the vendor's own credential file, checked without reading it. */
export const CLI_LOGIN_MARKERS: Record<CliKind, { bin: string; credentialFile: string; loginHint: string }> = {
  claude_code: { bin: 'claude', credentialFile: '.claude/.credentials.json', loginHint: 'docker compose run --rm cli-runner claude  (then run /login)' },
  codex: { bin: 'codex', credentialFile: '.codex/auth.json', loginHint: 'docker compose run --rm cli-runner codex login --device-auth' },
  gemini_cli: { bin: 'gemini', credentialFile: '.gemini/oauth_creds.json', loginHint: 'docker compose run --rm cli-runner gemini  (choose "Login with Google")' },
};
