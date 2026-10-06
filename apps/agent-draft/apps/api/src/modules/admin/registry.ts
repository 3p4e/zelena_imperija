import type { FastifyInstance } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { kindRequiresApiKey } from '@agent/providers';
import {
  createProviderSchema,
  updateProviderSchema,
  upsertAgentDefinitionSchema,
  upsertMcpServerSchema,
  upsertModelSchema,
  type AgentDefinition,
  type McpServer,
} from '@agent/shared';
import type { AppDeps } from '../../deps.js';
import { syncProviderModels } from '../providers/model-sync.js';
import {
  agentDefinitionTools,
  agentDefinitions,
  mcpServers,
  models,
  providers,
  toolCatalog,
} from '../../db/schema/index.js';
import { currentUser } from '../../auth/plugin.js';
import { resolveCredential } from '../../credentials/resolver.js';
import { AppError, notFound } from '../../lib/errors.js';
import { parseBody, requireUuid } from '../../lib/validate.js';
import { modelDto } from '../dto.js';

const priceStr = (n: number | null | undefined): string | null | undefined =>
  n === undefined ? undefined : n === null ? null : String(n);

export function registerAdminRegistryRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  app.get('/admin/providers', async () => db.select().from(providers).orderBy(asc(providers.displayName)));

  app.post('/admin/providers', async (req, reply) => {
    const body = parseBody(createProviderSchema, req.body);
    if (body.kind === 'openai_compatible' && !body.baseUrl)
      throw new AppError(
        'validation_failed',
        'An OpenAI-compatible provider needs a base URL (e.g. http://ollama:11434/v1).',
      );
    const [row] = await db
      .insert(providers)
      .values({
        kind: body.kind,
        slug: body.slug,
        displayName: body.displayName,
        baseUrl: body.baseUrl ?? null,
        requiresKey: body.requiresKey ?? kindRequiresApiKey(body.kind),
        enabled: body.enabled,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new AppError('conflict', 'A provider with this slug already exists.');
    return reply.code(201).send(row);
  });

  app.patch('/admin/providers/:id', async (req) => {
    const id = requireUuid((req.params as { id: string }).id);
    const body = parseBody(updateProviderSchema, req.body);
    const [row] = await db
      .update(providers)
      .set({
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.baseUrl !== undefined ? { baseUrl: body.baseUrl } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      })
      .where(eq(providers.id, id))
      .returning();
    if (!row) throw notFound('Provider');
    return row;
  });

  /**
   * Pulls the live model list using the admin's own key for that provider. New ids are
   * added; ids the provider no longer lists are marked unavailable (manual rows are kept).
   * Prices are only overwritten when the provider publishes them (OpenRouter).
   */
  app.post('/admin/providers/:id/refresh-models', async (req) => {
    const admin = currentUser(req);
    const id = requireUuid((req.params as { id: string }).id);
    const provider = await db.query.providers.findFirst({ where: eq(providers.id, id) });
    if (!provider) throw notFound('Provider');
    const probe = await db.query.models.findFirst({ where: eq(models.providerId, id) });
    const cred = await resolveCredential(
      db,
      deps.vault,
      { id: admin.id, role: 'admin' },
      {
        id: probe?.id ?? '00000000-0000-0000-0000-000000000000',
        modelId: '',
        displayName: '',
        providerId: provider.id,
        providerSlug: provider.slug,
        providerKind: provider.kind,
        baseUrl: provider.baseUrl,
        requiresKey: provider.requiresKey,
        available: true,
        supportsTools: true,
        pricing: { inputPricePerMtok: null, outputPricePerMtok: null, cachedInputPricePerMtok: null },
      },
      'byok',
    );
    const listed = await deps
      .providerFactory(provider.kind, { apiKey: cred.apiKey, baseUrl: cred.baseUrl, timeoutMs: 30_000 })
      .listModels();
    return syncProviderModels(db, id, listed, { retire: true });
  });

  app.get('/admin/models', async () => {
    const rows = await db
      .select({ m: models, p: providers })
      .from(models)
      .innerJoin(providers, eq(providers.id, models.providerId))
      .orderBy(asc(providers.displayName), asc(models.displayName));
    return rows.map(({ m, p }) => modelDto(m, p));
  });

  app.post('/admin/providers/:id/models', async (req, reply) => {
    const id = requireUuid((req.params as { id: string }).id);
    const body = parseBody(upsertModelSchema, req.body);
    const provider = await db.query.providers.findFirst({ where: eq(providers.id, id) });
    if (!provider) throw notFound('Provider');
    const [row] = await db
      .insert(models)
      .values({
        providerId: id,
        modelId: body.modelId,
        displayName: body.displayName,
        contextWindow: body.contextWindow,
        maxOutput: body.maxOutput ?? null,
        inputPricePerMtok: priceStr(body.inputPricePerMtok) ?? null,
        outputPricePerMtok: priceStr(body.outputPricePerMtok) ?? null,
        cachedInputPricePerMtok: priceStr(body.cachedInputPricePerMtok) ?? null,
        supportsVision: body.supportsVision,
        supportsTools: body.supportsTools,
        supportsReasoning: body.supportsReasoning,
        supportsStructuredOutput: body.supportsStructuredOutput,
        available: body.available,
        source: 'manual',
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new AppError('conflict', 'This model id already exists for the provider.');
    return reply.code(201).send(modelDto(row, provider));
  });

  app.patch('/admin/models/:id', async (req) => {
    const id = requireUuid((req.params as { id: string }).id);
    const body = parseBody(upsertModelSchema.partial(), req.body);
    const [row] = await db
      .update(models)
      .set({
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.contextWindow !== undefined ? { contextWindow: body.contextWindow } : {}),
        ...(body.maxOutput !== undefined ? { maxOutput: body.maxOutput } : {}),
        ...(body.inputPricePerMtok !== undefined
          ? { inputPricePerMtok: priceStr(body.inputPricePerMtok) }
          : {}),
        ...(body.outputPricePerMtok !== undefined
          ? { outputPricePerMtok: priceStr(body.outputPricePerMtok) }
          : {}),
        ...(body.cachedInputPricePerMtok !== undefined
          ? { cachedInputPricePerMtok: priceStr(body.cachedInputPricePerMtok) }
          : {}),
        ...(body.supportsVision !== undefined ? { supportsVision: body.supportsVision } : {}),
        ...(body.supportsTools !== undefined ? { supportsTools: body.supportsTools } : {}),
        ...(body.supportsReasoning !== undefined ? { supportsReasoning: body.supportsReasoning } : {}),
        ...(body.supportsStructuredOutput !== undefined
          ? { supportsStructuredOutput: body.supportsStructuredOutput }
          : {}),
        ...(body.available !== undefined ? { available: body.available } : {}),
      })
      .where(eq(models.id, id))
      .returning();
    if (!row) throw notFound('Model');
    const p = await db.query.providers.findFirst({ where: eq(providers.id, row.providerId) });
    if (!p) throw notFound('Provider');
    return modelDto(row, p);
  });

  const agentDto = async (a: typeof agentDefinitions.$inferSelect): Promise<AgentDefinition> => {
    const tools = await db
      .select({ name: agentDefinitionTools.toolName })
      .from(agentDefinitionTools)
      .where(eq(agentDefinitionTools.agentDefinitionId, a.id));
    return {
      id: a.id,
      slug: a.slug,
      displayName: a.displayName,
      roleDescription: a.roleDescription,
      systemPrompt: a.systemPrompt,
      defaultModelId: a.defaultModelId,
      maxIterations: a.maxIterations,
      enabled: a.enabled,
      isPrimary: a.isPrimary,
      toolNames: tools.map((t) => t.name),
    };
  };

  app.get('/admin/agents', async () =>
    Promise.all(
      (await db.select().from(agentDefinitions).orderBy(asc(agentDefinitions.displayName))).map(agentDto),
    ),
  );

  const saveAgent = async (
    id: string | null,
    body: ReturnType<typeof upsertAgentDefinitionSchema.parse>,
  ): Promise<AgentDefinition> =>
    db.transaction(async (tx) => {
      if (body.isPrimary) await tx.update(agentDefinitions).set({ isPrimary: false });
      const values = {
        slug: body.slug,
        displayName: body.displayName,
        roleDescription: body.roleDescription,
        systemPrompt: body.systemPrompt,
        defaultModelId: body.defaultModelId ?? null,
        maxIterations: body.maxIterations,
        enabled: body.enabled,
        isPrimary: body.isPrimary,
      };
      const [row] = id
        ? await tx.update(agentDefinitions).set(values).where(eq(agentDefinitions.id, id)).returning()
        : await tx.insert(agentDefinitions).values(values).onConflictDoNothing().returning();
      if (!row) throw id ? notFound('Agent') : new AppError('conflict', 'An agent with this slug exists.');
      await tx.delete(agentDefinitionTools).where(eq(agentDefinitionTools.agentDefinitionId, row.id));
      if (body.toolNames.length > 0)
        await tx
          .insert(agentDefinitionTools)
          .values([...new Set(body.toolNames)].map((toolName) => ({ agentDefinitionId: row.id, toolName })));
      const tools = await tx
        .select({ name: agentDefinitionTools.toolName })
        .from(agentDefinitionTools)
        .where(eq(agentDefinitionTools.agentDefinitionId, row.id));
      return {
        id: row.id,
        slug: row.slug,
        displayName: row.displayName,
        roleDescription: row.roleDescription,
        systemPrompt: row.systemPrompt,
        defaultModelId: row.defaultModelId,
        maxIterations: row.maxIterations,
        enabled: row.enabled,
        isPrimary: row.isPrimary,
        toolNames: tools.map((t) => t.name),
      };
    });

  app.post('/admin/agents', async (req, reply) =>
    reply.code(201).send(await saveAgent(null, parseBody(upsertAgentDefinitionSchema, req.body))),
  );
  app.put('/admin/agents/:id', async (req) =>
    saveAgent(
      requireUuid((req.params as { id: string }).id),
      parseBody(upsertAgentDefinitionSchema, req.body),
    ),
  );

  const mcpDto = async (s: typeof mcpServers.$inferSelect): Promise<McpServer> => {
    const tools = await db
      .select({ name: toolCatalog.name })
      .from(toolCatalog)
      .where(eq(toolCatalog.mcpServerId, s.id));
    return {
      id: s.id,
      name: s.name,
      transport: s.transport,
      command: s.command,
      args: s.args,
      url: s.url,
      enabled: s.enabled,
      hasEnv: s.envCiphertext !== null,
      lastError: s.lastError,
      toolCount: tools.length,
    };
  };

  app.get('/admin/mcp-servers', async () => Promise.all((await deps.tools.globalServers()).map(mcpDto)));

  const saveMcp = async (
    id: string | null,
    body: ReturnType<typeof upsertMcpServerSchema.parse>,
  ): Promise<McpServer> => {
    if (body.transport === 'stdio' && !body.command)
      throw new AppError('validation_failed', 'A stdio MCP server needs a command.');
    if (body.transport === 'http' && !body.url)
      throw new AppError('validation_failed', 'An HTTP MCP server needs a URL.');
    const base = {
      name: body.name,
      transport: body.transport,
      command: body.command ?? null,
      args: body.args,
      url: body.url ?? null,
      enabled: body.enabled,
    };
    const [row] = id
      ? await db.update(mcpServers).set(base).where(eq(mcpServers.id, id)).returning()
      : await db
          .insert(mcpServers)
          .values({ ...base, ownerUserId: null })
          .onConflictDoNothing()
          .returning();
    if (!row)
      throw id ? notFound('MCP server') : new AppError('conflict', 'An MCP server with this name exists.');
    if (body.env !== undefined) {
      const sealed = deps.vault.sealGlobal(`mcp:${row.id}`, JSON.stringify(body.env));
      await db
        .update(mcpServers)
        .set({ envCiphertext: sealed.ciphertext, envNonce: sealed.nonce })
        .where(eq(mcpServers.id, row.id));
    }
    await deps.tools.mcp.disconnect(row.id);
    await deps.tools.deleteCatalogForServer(row.id);
    const fresh = await db.query.mcpServers.findFirst({ where: eq(mcpServers.id, row.id) });
    if (!fresh) throw notFound('MCP server');
    if (fresh.enabled) await deps.tools.connectServer(fresh);
    await deps.tools.syncCatalog();
    const after = await db.query.mcpServers.findFirst({ where: eq(mcpServers.id, row.id) });
    return mcpDto(after ?? fresh);
  };

  app.post('/admin/mcp-servers', async (req, reply) =>
    reply.code(201).send(await saveMcp(null, parseBody(upsertMcpServerSchema, req.body))),
  );
  app.put('/admin/mcp-servers/:id', async (req) =>
    saveMcp(requireUuid((req.params as { id: string }).id), parseBody(upsertMcpServerSchema, req.body)),
  );

  app.post('/admin/mcp-servers/:id/reconnect', async (req) => {
    const id = requireUuid((req.params as { id: string }).id);
    const row = await db.query.mcpServers.findFirst({ where: eq(mcpServers.id, id) });
    if (!row) throw notFound('MCP server');
    await deps.tools.connectServer(row);
    await deps.tools.syncCatalog();
    const after = await db.query.mcpServers.findFirst({ where: eq(mcpServers.id, id) });
    return mcpDto(after ?? row);
  });

  app.delete('/admin/mcp-servers/:id', async (req) => {
    const id = requireUuid((req.params as { id: string }).id);
    await deps.tools.mcp.disconnect(id);
    await deps.tools.deleteCatalogForServer(id);
    await db.delete(mcpServers).where(eq(mcpServers.id, id));
    await deps.tools.syncCatalog();
    return { ok: true };
  });
}
