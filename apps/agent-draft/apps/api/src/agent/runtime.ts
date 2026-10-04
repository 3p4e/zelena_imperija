import { and, desc, eq, gt } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { ApiErrorCode, CliKind, UsageStatus } from '@agent/shared';
import {
  EMPTY_USAGE,
  ProviderError,
  type AIProvider,
  type ChatRequest,
  type ProviderFactory,
  type Usage,
} from '@agent/providers';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/client.js';
import {
  agentDefinitionTools,
  agentDefinitions,
  conversations,
  globalSettings,
  messageParts,
  messages,
  projects,
} from '../db/schema/index.js';
import type { KeyVault } from '../credentials/vault.js';
import {
  loadModel,
  resolveCredential,
  type ResolvedCredential,
  type ResolvedModel,
} from '../credentials/resolver.js';
import { preflight } from '../credentials/preflight.js';
import { estimateCostUsd } from '../metering/cost.js';
import { recordUsage } from '../metering/usage.js';
import { AppError, fromProviderError } from '../lib/errors.js';
import type { ToolRegistry } from '../tools/registry.js';
import { ToolInputError, type Tool, type ToolContext, type ToolResult } from '../tools/types.js';
import type { CliRunner } from '../cli/runner.js';
import { RunBus } from './bus.js';
import { fitToContext, loadHistory } from './history.js';
import { resolveSelection, type SelectionInput } from './selection.js';
import { MessageWriter } from './writer.js';

export interface RuntimeDeps {
  db: Db;
  vault: KeyVault;
  providerFactory: ProviderFactory;
  tools: ToolRegistry;
  cli: CliRunner;
  config: AppConfig;
  log: Logger;
}

export interface Actor {
  id: string;
  role: 'admin' | 'member';
}

export interface StartTurnInput {
  conversationId: string;
  actor: Actor;
  /** New user text, or null to regenerate the answer to the last user message. */
  content: string | null;
  selection: SelectionInput;
}

interface RunContext {
  conversation: typeof conversations.$inferSelect;
  project: typeof projects.$inferSelect;
  actor: Actor;
  selection: SelectionInput;
  signal: AbortSignal;
}

const PROVIDER_TIMEOUT_MS = 600_000;
const MAX_ATTEMPTS = 3;

/**
 * Runs one agent turn: plan → call model → execute tools → feed results back →
 * repeat until the model stops calling tools, the iteration limit is reached,
 * the user stops it, or a quota/safety cap is hit. Every provider call is
 * metered; every step is persisted and mirrored onto the run bus.
 */
export class AgentRuntime {
  readonly bus = new RunBus();
  private readonly active = new Map<string, AbortController>();

  constructor(private readonly deps: RuntimeDeps) {}

  isRunning(conversationId: string): boolean {
    return this.active.has(conversationId);
  }

  stop(conversationId: string): boolean {
    const c = this.active.get(conversationId);
    if (!c) return false;
    c.abort();
    return true;
  }

  async start(input: StartTurnInput): Promise<void> {
    const { db } = this.deps;
    if (this.active.has(input.conversationId))
      throw new AppError('conflict', 'The agent is already working in this conversation. Stop it first.');
    const conversation = await db.query.conversations.findFirst({
      where: eq(conversations.id, input.conversationId),
    });
    if (!conversation) throw new AppError('not_found', 'Conversation not found.');
    const project = await db.query.projects.findFirst({ where: eq(projects.id, conversation.projectId) });
    if (!project) throw new AppError('not_found', 'Project not found.');
    if (project.status === 'archived') throw new AppError('conflict', 'This project is archived.');

    // Reject forbidden selections before anything is written.
    if (input.selection.credentialMode === 'subscription_cli' && input.actor.role !== 'admin') {
      throw new AppError('forbidden', 'Subscription CLI mode is available to the admin only.');
    }

    const controller = new AbortController();
    this.active.set(input.conversationId, controller);
    this.bus.open(input.conversationId);

    try {
      if (input.content !== null) {
        const w = await MessageWriter.create(db, this.bus, conversation.id, 'user', { status: 'complete' });
        await w.startPart('text', { text: input.content });
        if (conversation.title === 'New conversation') {
          const title = input.content.replace(/\s+/g, ' ').trim().slice(0, 60) || 'New conversation';
          await db.update(conversations).set({ title }).where(eq(conversations.id, conversation.id));
        }
      } else {
        await this.supersedeLastAnswer(conversation.id);
      }
      await db.update(conversations).set({ status: 'running' }).where(eq(conversations.id, conversation.id));
      this.bus.emit(conversation.id, { type: 'conversation_status', status: 'running' });
    } catch (err) {
      this.active.delete(input.conversationId);
      this.bus.close(input.conversationId);
      throw err;
    }

    const ctx: RunContext = {
      conversation,
      project,
      actor: input.actor,
      selection: input.selection,
      signal: controller.signal,
    };
    void this.run(ctx).finally(() => {
      this.active.delete(input.conversationId);
      this.bus.close(input.conversationId);
    });
  }

  private async supersedeLastAnswer(conversationId: string): Promise<void> {
    const { db } = this.deps;
    const lastUser = await db.query.messages.findFirst({
      where: and(
        eq(messages.conversationId, conversationId),
        eq(messages.role, 'user'),
        eq(messages.superseded, false),
      ),
      orderBy: [desc(messages.seq)],
    });
    if (!lastUser) throw new AppError('validation_failed', 'There is no message to regenerate.');
    await db
      .update(messages)
      .set({ superseded: true })
      .where(and(eq(messages.conversationId, conversationId), gt(messages.seq, lastUser.seq)));
  }

  private async run(ctx: RunContext): Promise<void> {
    const final = await this.execute(ctx).catch((err: unknown) => {
      this.deps.log.error(
        { err: errorSummary(err), conversationId: ctx.conversation.id },
        'run bookkeeping failed',
      );
      return 'error' as const;
    });
    await this.deps.db
      .update(conversations)
      .set({ status: final })
      .where(eq(conversations.id, ctx.conversation.id));
    this.bus.emit(ctx.conversation.id, { type: 'conversation_status', status: final });
  }

  /** Runs the turn and maps its outcome to the conversation status; user-facing errors are persisted. */
  private async execute(ctx: RunContext): Promise<'idle' | 'stopped' | 'error'> {
    try {
      const selection = await resolveSelection(this.deps.db, ctx.actor.id, {
        message: ctx.selection,
        conversation: {
          modelId: ctx.conversation.modelId,
          credentialMode: ctx.conversation.credentialMode,
          cliKind: ctx.conversation.cliKind,
        },
        project: {
          modelId: ctx.project.defaultModelId,
          credentialMode: ctx.project.defaultCredentialMode,
          cliKind: ctx.project.defaultCliKind,
        },
      });
      const outcome =
        selection.kind === 'cli'
          ? await this.runCli(ctx, selection.cliKind)
          : await this.runApi(ctx, selection.modelRef, selection.credentialMode);
      return outcome === 'stopped' ? 'stopped' : 'idle';
    } catch (err) {
      if (ctx.signal.aborted) return 'stopped';
      await this.reportError(ctx, err);
      return 'error';
    }
  }

  private async reportError(ctx: RunContext, err: unknown): Promise<void> {
    const appErr = toAppError(err);
    if (appErr.code === 'internal')
      this.deps.log.error(
        { err: errorSummary(err), conversationId: ctx.conversation.id },
        'agent run failed',
      );
    const w = await MessageWriter.create(this.deps.db, this.bus, ctx.conversation.id, 'assistant');
    await w.errorPart(appErr.message);
    await w.finish('error');
    w.end('error', { code: appErr.code, message: appErr.message });
  }

  private async agentConfig(
    conversation: typeof conversations.$inferSelect,
  ): Promise<{ systemPrompt: string; toolNames: string[]; maxIterations: number }> {
    const { db } = this.deps;
    const agent = await db.query.agentDefinitions.findFirst({
      where: eq(agentDefinitions.id, conversation.agentDefinitionId),
    });
    if (!agent?.enabled)
      throw new AppError('validation_failed', 'The agent for this conversation is disabled.');
    const toolRows = await db
      .select({ name: agentDefinitionTools.toolName })
      .from(agentDefinitionTools)
      .where(eq(agentDefinitionTools.agentDefinitionId, agent.id));
    const settings = await db.query.globalSettings.findFirst({ where: eq(globalSettings.id, 1) });
    const maxIterations = Math.min(agent.maxIterations, settings?.agentMaxIterations ?? agent.maxIterations);
    return { systemPrompt: agent.systemPrompt, toolNames: toolRows.map((t) => t.name), maxIterations };
  }

  private async runApi(
    ctx: RunContext,
    modelRef: string,
    mode: 'byok' | 'shared' | null,
  ): Promise<'complete' | 'stopped'> {
    const { db } = this.deps;
    const model = await loadModel(db, modelRef);
    if (!model.available)
      throw new AppError(
        'model_unavailable',
        `${model.displayName} is marked unavailable. Pick another model.`,
      );
    const credential = await resolveCredential(db, this.deps.vault, ctx.actor, model, mode);
    const provider = this.deps.providerFactory(model.providerKind, {
      apiKey: credential.apiKey,
      baseUrl: credential.baseUrl,
      timeoutMs: PROVIDER_TIMEOUT_MS,
    });
    const agent = await this.agentConfig(ctx.conversation);
    const tools = model.supportsTools ? await this.deps.tools.toolsFor(ctx.actor, agent.toolNames) : [];
    const contextWindow =
      (await db.query.models.findFirst({ where: (m, { eq: e }) => e(m.id, model.id) }))?.contextWindow ??
      128_000;
    const systemPrompt = `${agent.systemPrompt}\n\nProject: ${ctx.project.name}${ctx.project.description ? `\n${ctx.project.description}` : ''}`;

    let runCost = 0;
    for (let iteration = 0; iteration < agent.maxIterations; iteration++) {
      if (ctx.signal.aborted) return 'stopped';
      await this.gate(ctx, model, credential, runCost);

      const history = fitToContext(await loadHistory(db, ctx.conversation.id), contextWindow);
      const request: ChatRequest = {
        model: model.modelId,
        messages: [{ role: 'system', content: [{ type: 'text', text: systemPrompt }] }, ...history],
        signal: ctx.signal,
        ...(tools.length > 0
          ? {
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
              })),
            }
          : {}),
      };
      const w = await MessageWriter.create(db, this.bus, ctx.conversation.id, 'assistant', {
        modelId: model.id,
        credentialMode: credential.mode,
      });
      const step = await this.streamStep(ctx, provider, request, w, model, credential);
      if (step.status === 'stopped') {
        await w.flushOpen();
        await w.finish('stopped');
        w.end('stopped');
        return 'stopped';
      }
      runCost += step.costUsd ?? 0;
      await w.finish('complete');
      w.end('complete');
      if (step.toolCalls.length === 0) return 'complete';

      const toolMsg = await MessageWriter.create(db, this.bus, ctx.conversation.id, 'tool', {
        modelId: model.id,
      });
      for (const call of step.toolCalls) {
        const partId = await toolMsg.startPart('tool_result', { toolName: call.name, toolCallId: call.id });
        const result = ctx.signal.aborted
          ? { content: 'Cancelled by the user.', isError: true }
          : await this.executeTool(ctx, tools, call, partId, toolMsg);
        await toolMsg.finishToolResult(partId, call.id, call.name, result.content, result.isError);
      }
      await toolMsg.finish('complete');
      if (ctx.signal.aborted) return 'stopped';
    }
    const w = await MessageWriter.create(db, this.bus, ctx.conversation.id, 'assistant', {
      modelId: model.id,
    });
    await w.errorPart(
      `Stopped after ${agent.maxIterations} steps (the agent's iteration limit). Send a message to continue.`,
    );
    await w.finish('complete');
    w.end('complete');
    return 'complete';
  }

  /** Pre-flight gate; a block is metered as a zero-token record so it appears in usage history. */
  private async gate(
    ctx: RunContext,
    model: ResolvedModel,
    credential: ResolvedCredential,
    runCost: number,
  ): Promise<void> {
    try {
      await preflight(this.deps.db, {
        actor: ctx.actor,
        credential,
        pricing: model.pricing,
        runCostUsd: runCost,
      });
    } catch (err) {
      if (err instanceof AppError && (err.code === 'quota_exceeded' || err.code === 'safety_cap_reached')) {
        await recordUsage(this.deps.db, {
          ...this.usageBase(ctx, model, credential, null),
          ...zeroUsage(),
          estimatedCostUsd: 0,
          durationMs: 0,
          status: err.code === 'quota_exceeded' ? 'blocked_quota' : 'blocked_cap',
          errorCode: err.code,
        });
      }
      throw err;
    }
  }

  private usageBase(
    ctx: RunContext,
    model: ResolvedModel,
    credential: ResolvedCredential,
    messageId: string | null,
  ) {
    return {
      userId: ctx.actor.id,
      projectId: ctx.project.id,
      conversationId: ctx.conversation.id,
      messageId,
      providerId: model.providerId,
      providerSlug: model.providerSlug,
      modelRef: model.id,
      modelId: model.modelId,
      credentialSource: credential.mode,
      userKeyId: credential.userKeyId,
      sharedKeyGrantId: credential.sharedKeyGrantId,
    };
  }

  private async streamStep(
    ctx: RunContext,
    provider: AIProvider,
    request: ChatRequest,
    w: MessageWriter,
    model: ResolvedModel,
    credential: ResolvedCredential,
  ): Promise<{
    status: 'complete' | 'stopped';
    toolCalls: { id: string; name: string; arguments: unknown }[];
    costUsd: number | null;
  }> {
    const started = Date.now();
    let usage: Usage = EMPTY_USAGE;
    const toolCalls: { id: string; name: string; arguments: unknown }[] = [];
    let textPart: string | null = null;
    let reasoningPart: string | null = null;
    const toolParts = new Map<string, string>();
    let emitted = false;

    const closeText = async (): Promise<void> => {
      if (textPart) await w.endPart(textPart);
      textPart = null;
    };
    const closeReasoning = async (): Promise<void> => {
      if (reasoningPart) await w.endPart(reasoningPart);
      reasoningPart = null;
    };

    for (let attempt = 1; ; attempt++) {
      try {
        for await (const ev of provider.stream(request)) {
          emitted = true;
          switch (ev.type) {
            case 'text_delta':
              await closeReasoning();
              textPart ??= await w.startPart('text');
              w.delta(textPart, ev.text);
              break;
            case 'reasoning_delta':
              reasoningPart ??= await w.startPart('reasoning');
              w.delta(reasoningPart, ev.text);
              break;
            case 'tool_call_start':
              await closeText();
              await closeReasoning();
              toolParts.set(ev.id, await w.startPart('tool_call', { toolName: ev.name, toolCallId: ev.id }));
              break;
            case 'tool_call_delta': {
              const pid = toolParts.get(ev.id);
              if (pid) w.delta(pid, ev.argumentsDelta);
              break;
            }
            case 'tool_call_end': {
              let pid = toolParts.get(ev.id);
              pid ??= await w.startPart('tool_call', { toolName: ev.name, toolCallId: ev.id });
              await w.setArguments(pid, ev.arguments);
              toolCalls.push({ id: ev.id, name: ev.name, arguments: ev.arguments });
              break;
            }
            case 'usage':
              usage = ev.usage;
              break;
            case 'finish':
              break;
          }
        }
        break;
      } catch (err) {
        if (ctx.signal.aborted) {
          await this.meter(ctx, model, credential, w.messageId, usage, started, 'error', 'aborted');
          return { status: 'stopped', toolCalls, costUsd: null };
        }
        const retryable = err instanceof ProviderError && err.retryable && !emitted && attempt < MAX_ATTEMPTS;
        if (!retryable) {
          const status: UsageStatus =
            err instanceof ProviderError
              ? err.code === 'rate_limited'
                ? 'rate_limited'
                : err.code === 'timeout'
                  ? 'timeout'
                  : 'error'
              : 'error';
          await this.meter(
            ctx,
            model,
            credential,
            w.messageId,
            usage,
            started,
            status,
            err instanceof ProviderError ? err.code : 'internal',
          );
          await w.flushOpen();
          await w.finish('error');
          throw err;
        }
        const wait = Math.min(err.retryAfterMs ?? 1000 * 2 ** (attempt - 1), 20_000);
        this.deps.log.warn({ attempt, wait, code: err.code }, 'retrying provider call');
        await sleep(wait, ctx.signal);
        if (ctx.signal.aborted) return { status: 'stopped', toolCalls, costUsd: null };
      }
    }
    await closeText();
    await closeReasoning();
    const cost = await this.meter(ctx, model, credential, w.messageId, usage, started, 'ok', null);
    return { status: 'complete', toolCalls, costUsd: cost };
  }

  private async meter(
    ctx: RunContext,
    model: ResolvedModel,
    credential: ResolvedCredential,
    messageId: string,
    usage: Usage,
    started: number,
    status: UsageStatus,
    errorCode: string | null,
  ): Promise<number | null> {
    const cost = estimateCostUsd(usage, model.pricing);
    await recordUsage(this.deps.db, {
      ...this.usageBase(ctx, model, credential, messageId),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      reasoningTokens: usage.reasoningTokens,
      estimatedCostUsd: cost,
      durationMs: Date.now() - started,
      status,
      errorCode,
    });
    if (status === 'ok') {
      this.bus.emit(ctx.conversation.id, {
        type: 'usage',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        estimatedCostUsd: cost,
      });
    }
    return cost;
  }

  private async executeTool(
    ctx: RunContext,
    tools: Tool[],
    call: { id: string; name: string; arguments: unknown },
    partId: string,
    w: MessageWriter,
  ): Promise<ToolResult> {
    const tool = tools.find((t) => t.name === call.name);
    if (!tool)
      return { content: `Tool "${call.name}" is not available in this conversation.`, isError: true };
    // Re-check at execution time: the admin may have changed restrictions mid-run.
    if (!(await this.deps.tools.isAllowedFor(ctx.actor, tool.name))) {
      return { content: `You are not permitted to use "${tool.name}".`, isError: true };
    }
    let args: unknown;
    try {
      args = tool.parse(call.arguments);
    } catch (err) {
      if (err instanceof ToolInputError)
        return { content: `Invalid arguments for ${tool.name}: ${err.message}`, isError: true };
      throw err;
    }
    const toolCtx: ToolContext = {
      projectId: ctx.project.id,
      conversationId: ctx.conversation.id,
      actorUserId: ctx.actor.id,
      ownerUserId: ctx.project.ownerUserId,
      messagePartId: partId,
      signal: ctx.signal,
      onProgress: (text) => w.delta(partId, text),
    };
    try {
      return await tool.handler(toolCtx, args);
    } catch (err) {
      if (err instanceof AppError) return { content: err.message, isError: true };
      this.deps.log.error({ tool: tool.name, err: errorSummary(err) }, 'tool failed');
      return { content: `${tool.name} failed with an internal error.`, isError: true };
    }
  }

  private async runCli(ctx: RunContext, cliKind: CliKind): Promise<'complete' | 'stopped'> {
    const { db } = this.deps;
    if (ctx.actor.role !== 'admin')
      throw new AppError('forbidden', 'Subscription CLI mode is available to the admin only.');
    const lastUser = await db
      .select({ text: messageParts.text })
      .from(messages)
      .innerJoin(messageParts, eq(messageParts.messageId, messages.id))
      .where(
        and(
          eq(messages.conversationId, ctx.conversation.id),
          eq(messages.role, 'user'),
          eq(messages.superseded, false),
        ),
      )
      .orderBy(desc(messages.seq))
      .limit(1);
    const prompt = lastUser[0]?.text;
    if (!prompt) throw new AppError('validation_failed', 'Nothing to send.');

    const w = await MessageWriter.create(db, this.bus, ctx.conversation.id, 'assistant', {
      credentialMode: 'subscription_cli',
      cliKind,
    });
    let textPart: string | null = null;
    const toolParts = new Map<string, string>();
    const started = Date.now();
    const result = await this.deps.cli.run({
      kind: cliKind,
      projectId: ctx.project.id,
      ownerUserId: ctx.project.ownerUserId,
      prompt,
      resumeSessionId: ctx.conversation.cliKind === cliKind ? ctx.conversation.cliSessionId : null,
      signal: ctx.signal,
      onEvent: async (ev) => {
        if (ev.type === 'text') {
          textPart ??= await w.startPart('text');
          w.delta(textPart, ev.text);
        } else if (ev.type === 'tool_call') {
          if (textPart) await w.endPart(textPart);
          textPart = null;
          const pid = await w.startPart('tool_call', {
            toolName: ev.name,
            toolCallId: ev.id,
            arguments: ev.input,
          });
          await w.setArguments(pid, ev.input);
          toolParts.set(ev.id, pid);
        } else {
          const pid = await w.startPart('tool_result', { toolName: ev.name, toolCallId: ev.id });
          await w.finishToolResult(pid, ev.id, ev.name, ev.content, ev.isError);
        }
      },
    });
    if (textPart) await w.endPart(textPart);
    await db
      .update(conversations)
      .set({ cliSessionId: result.sessionId ?? ctx.conversation.cliSessionId, cliKind })
      .where(eq(conversations.id, ctx.conversation.id));
    await recordUsage(db, {
      userId: ctx.actor.id,
      projectId: ctx.project.id,
      conversationId: ctx.conversation.id,
      messageId: w.messageId,
      providerId: null,
      providerSlug: cliKind,
      modelRef: null,
      modelId: result.model ?? `cli:${cliKind}`,
      credentialSource: 'subscription_cli',
      userKeyId: null,
      sharedKeyGrantId: null,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cachedInputTokens: result.usage.cachedInputTokens,
      reasoningTokens: null,
      // Subscription usage has no per-request price; it is recorded but never counted as spend.
      estimatedCostUsd: null,
      durationMs: Date.now() - started,
      status: result.status === 'ok' ? 'ok' : result.status === 'stopped' ? 'error' : 'error',
      errorCode: result.status === 'ok' ? null : (result.errorMessage?.slice(0, 120) ?? result.status),
    });
    if (result.status === 'stopped') {
      await w.flushOpen();
      await w.finish('stopped');
      w.end('stopped');
      return 'stopped';
    }
    if (result.status === 'error') {
      const message = result.errorMessage ?? 'The CLI run failed.';
      await w.errorPart(message);
      await w.finish('error');
      w.end('error', { code: 'cli_unavailable', message });
      return 'complete';
    }
    await w.finish('complete');
    w.end('complete');
    return 'complete';
  }
}

function zeroUsage() {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: null };
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ProviderError) return fromProviderError(err);
  return new AppError(
    'internal' satisfies ApiErrorCode,
    'Something went wrong while running the agent. Try again.',
  );
}

function errorSummary(err: unknown): { name: string; message: string } {
  return err instanceof Error
    ? { name: err.name, message: err.message.slice(0, 500) }
    : { name: 'unknown', message: String(err).slice(0, 500) };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
