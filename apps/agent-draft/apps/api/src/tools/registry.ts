import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../db/client.js';
import { mcpServers, memberToolRestrictions, toolCatalog } from '../db/schema/index.js';
import type { KeyVault } from '../credentials/vault.js';
import { MCP_TOOL_PREFIX, McpHub, type McpServerConfig } from './mcp.js';
import type { Tool } from './types.js';

export const MCP_WILDCARD = 'mcp__*';

/**
 * Holds every tool the platform knows about (built-in + MCP), mirrors them into
 * `tool_catalog`, and answers "which tools may this user's agent call".
 *
 * Policy:
 * - admin: every enabled tool;
 * - member: built-in tools unless the admin denied them; MCP tools only when the
 *   admin explicitly allowed them (they run with the admin's server credentials).
 */
export class ToolRegistry {
  private readonly builtins = new Map<string, Tool>();
  readonly mcp: McpHub;

  constructor(
    private readonly db: Db,
    private readonly vault: KeyVault,
    private readonly log: Logger,
  ) {
    this.mcp = new McpHub(log);
  }

  register(tool: Tool): void {
    if (this.builtins.has(tool.name)) throw new Error(`duplicate tool ${tool.name}`);
    if (tool.name.startsWith(MCP_TOOL_PREFIX))
      throw new Error('built-in tool names may not use the mcp__ prefix');
    this.builtins.set(tool.name, tool);
  }

  all(): Tool[] {
    return [...this.builtins.values(), ...this.mcp.tools()];
  }

  get(name: string): Tool | undefined {
    return this.builtins.get(name) ?? this.mcp.tools().find((t) => t.name === name);
  }

  /** Upserts catalog rows for all known tools; removes rows of tools that disappeared. */
  async syncCatalog(): Promise<void> {
    const tools = this.all();
    for (const t of tools) {
      await this.db
        .insert(toolCatalog)
        .values({
          name: t.name,
          source: t.source,
          mcpServerId: t.mcpServerId,
          description: t.description,
          inputSchema: t.inputSchema,
          permission: t.permission,
          requiresApproval: t.requiresApproval,
        })
        .onConflictDoUpdate({
          target: toolCatalog.name,
          set: {
            description: t.description,
            inputSchema: t.inputSchema,
            permission: t.permission,
            mcpServerId: t.mcpServerId,
          },
        });
    }
    const names = tools.map((t) => t.name);
    if (names.length > 0) await this.db.delete(toolCatalog).where(notInArray(toolCatalog.name, names));
  }

  /** (Re)connects all enabled MCP servers from the database. Failures are recorded, not thrown. */
  async loadMcpServers(): Promise<void> {
    await this.mcp.closeAll();
    const rows = await this.db.select().from(mcpServers).where(eq(mcpServers.enabled, true));
    for (const row of rows) {
      await this.connectServer(row);
    }
    await this.syncCatalog();
  }

  async connectServer(row: typeof mcpServers.$inferSelect): Promise<void> {
    try {
      const env =
        row.envCiphertext && row.envNonce
          ? (JSON.parse(
              this.vault.openGlobal(`mcp:${row.id}`, { ciphertext: row.envCiphertext, nonce: row.envNonce }),
            ) as Record<string, string>)
          : {};
      const cfg: McpServerConfig = {
        id: row.id,
        name: row.name,
        transport: row.transport,
        command: row.command,
        args: row.args,
        url: row.url,
        env,
      };
      await this.mcp.connect(cfg);
      await this.db.update(mcpServers).set({ lastError: null }).where(eq(mcpServers.id, row.id));
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 500) : 'connection failed';
      this.log.warn({ server: row.name, err: message }, 'mcp server failed to connect');
      await this.db.update(mcpServers).set({ lastError: message }).where(eq(mcpServers.id, row.id));
    }
  }

  async enabledCatalogNames(): Promise<Set<string>> {
    const rows = await this.db
      .select({ name: toolCatalog.name })
      .from(toolCatalog)
      .where(eq(toolCatalog.enabled, true));
    return new Set(rows.map((r) => r.name));
  }

  async isAllowedFor(user: { id: string; role: 'admin' | 'member' }, toolName: string): Promise<boolean> {
    const enabled = await this.enabledCatalogNames();
    if (!enabled.has(toolName)) return false;
    if (user.role === 'admin') return true;
    const r = await this.db.query.memberToolRestrictions.findFirst({
      where: and(eq(memberToolRestrictions.userId, user.id), eq(memberToolRestrictions.toolName, toolName)),
    });
    if (toolName.startsWith(MCP_TOOL_PREFIX)) return r?.allowed === true;
    return r?.allowed !== false;
  }

  /** Tools an agent may offer to the model for this user: agent config ∩ enabled ∩ user policy. */
  async toolsFor(user: { id: string; role: 'admin' | 'member' }, agentToolNames: string[]): Promise<Tool[]> {
    const wantsAllMcp = agentToolNames.includes(MCP_WILDCARD);
    const candidates = this.all().filter(
      (t) => agentToolNames.includes(t.name) || (wantsAllMcp && t.source === 'mcp'),
    );
    const out: Tool[] = [];
    for (const t of candidates) if (await this.isAllowedFor(user, t.name)) out.push(t);
    return out;
  }

  /** Global MCP servers visible for configuration (Phase 1: admin-owned only). */
  async globalServers(): Promise<(typeof mcpServers.$inferSelect)[]> {
    return this.db.select().from(mcpServers).where(isNull(mcpServers.ownerUserId));
  }

  async catalogFor(user: {
    id: string;
    role: 'admin' | 'member';
  }): Promise<(typeof toolCatalog.$inferSelect & { allowedForMe: boolean })[]> {
    const rows = await this.db.select().from(toolCatalog);
    const out = [];
    for (const r of rows) out.push({ ...r, allowedForMe: await this.isAllowedFor(user, r.name) });
    return out;
  }

  async deleteCatalogForServer(serverId: string): Promise<void> {
    await this.db.delete(toolCatalog).where(inArray(toolCatalog.mcpServerId, [serverId]));
  }
}
