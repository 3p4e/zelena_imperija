import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../../src/db/client.js';
import { mcpServers, memberToolRestrictions, toolCatalog, users } from '../../src/db/schema/index.js';
import { KeyVault } from '../../src/credentials/vault.js';
import { ToolRegistry, MCP_WILDCARD } from '../../src/tools/registry.js';
import { defineTool, ok } from '../../src/tools/define.js';
import { ToolInputError, type ToolContext } from '../../src/tools/types.js';
import { freshDatabase } from '../helpers/db.js';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/echo-mcp-server.mjs');
const ctx: ToolContext = {
  projectId: 'p',
  conversationId: null,
  actorUserId: 'u',
  ownerUserId: 'u',
  messagePartId: null,
  signal: undefined,
};

describe('ToolRegistry', () => {
  let db: DbHandle;
  let registry: ToolRegistry;
  let vault: KeyVault;
  const admin = { id: '', role: 'admin' as const };
  const member = { id: '', role: 'member' as const };

  beforeAll(async () => {
    db = createDb(await freshDatabase('unit_tools'));
    vault = new KeyVault(db.db, randomBytes(32).toString('base64'), 1);
    registry = new ToolRegistry(db.db, vault, pino({ level: 'silent' }));
    registry.register(
      defineTool({
        name: 'echo',
        description: 'Echo input',
        permission: 'read',
        auth: 'none',
        schema: z.object({ text: z.string().min(1) }),
        run: async (_c, a) => ok(a.text),
      }),
    );
    registry.register(
      defineTool({
        name: 'danger',
        description: 'x',
        permission: 'exec',
        schema: z.object({}),
        run: async () => ok('ran'),
      }),
    );
    await registry.syncCatalog();
    const [a] = await db.db
      .insert(users)
      .values({ email: 'a@x', displayName: 'A', role: 'admin' })
      .returning();
    const [m] = await db.db
      .insert(users)
      .values({ email: 'm@x', displayName: 'M', role: 'member' })
      .returning();
    admin.id = a?.id ?? '';
    member.id = m?.id ?? '';
  });
  afterAll(async () => {
    await registry.mcp.closeAll();
    await db.close();
  });

  it('derives JSON Schema from the zod schema and validates arguments', async () => {
    const echo = registry.get('echo');
    expect(echo?.inputSchema).toMatchObject({
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    });
    expect(() => echo?.parse({})).toThrow(ToolInputError);
    expect(await echo?.handler(ctx, echo.parse({ text: 'hi' }))).toEqual({ content: 'hi', isError: false });
  });

  it('rejects duplicate names and reserved prefixes', () => {
    const t = defineTool({
      name: 'echo',
      description: '',
      permission: 'read',
      schema: z.object({}),
      run: async () => ok(''),
    });
    expect(() => registry.register(t)).toThrow(/duplicate/);
    const reserved = defineTool({
      name: 'mcp__x',
      description: '',
      permission: 'read',
      schema: z.object({}),
      run: async () => ok(''),
    });
    expect(() => registry.register(reserved)).toThrow(/prefix/);
  });

  it('mirrors tools into the catalog', async () => {
    const rows = await db.db.select().from(toolCatalog);
    expect(rows.map((r) => r.name).sort()).toEqual(['danger', 'echo']);
  });

  it('applies the access policy: admin everything, members minus restrictions', async () => {
    expect((await registry.toolsFor(admin, ['echo', 'danger'])).map((t) => t.name)).toEqual([
      'echo',
      'danger',
    ]);
    expect((await registry.toolsFor(member, ['echo', 'danger'])).map((t) => t.name)).toEqual([
      'echo',
      'danger',
    ]);
    await db.db
      .insert(memberToolRestrictions)
      .values({ userId: member.id, toolName: 'danger', allowed: false });
    expect((await registry.toolsFor(member, ['echo', 'danger'])).map((t) => t.name)).toEqual(['echo']);
    expect(await registry.isAllowedFor(admin, 'danger')).toBe(true);
    // Disabling a tool globally removes it for everyone.
    await db.db.update(toolCatalog).set({ enabled: false }).where(eq(toolCatalog.name, 'echo'));
    expect(await registry.isAllowedFor(admin, 'echo')).toBe(false);
    await db.db.update(toolCatalog).set({ enabled: true }).where(eq(toolCatalog.name, 'echo'));
  });

  it('accepts an MCP server as a tool source, with encrypted env and default-deny for members', async () => {
    const [row] = await db.db
      .insert(mcpServers)
      .values({ name: 'echo', transport: 'stdio', command: process.execPath, args: [FIXTURE], enabled: true })
      .returning();
    if (!row) throw new Error('insert failed');
    const sealed = vault.sealGlobal(`mcp:${row.id}`, JSON.stringify({ ECHO_TOKEN: 's3cret' }));
    await db.db
      .update(mcpServers)
      .set({ envCiphertext: sealed.ciphertext, envNonce: sealed.nonce })
      .where(eq(mcpServers.id, row.id));
    await registry.loadMcpServers();

    const server = await db.db.query.mcpServers.findFirst({ where: eq(mcpServers.id, row.id) });
    expect(server?.lastError).toBeNull();
    const shout = registry.get('mcp__echo__shout');
    expect(shout?.source).toBe('mcp');
    expect(shout?.inputSchema).toMatchObject({ type: 'object', properties: { text: { type: 'string' } } });
    expect(await shout?.handler(ctx, { text: 'hello' })).toEqual({
      content: 'HELLO (token=s3cret)',
      isError: false,
    });
    expect(await registry.get('mcp__echo__fail')?.handler(ctx, {})).toEqual({
      content: 'nope',
      isError: true,
    });

    const catalog = await db.db.select().from(toolCatalog).where(eq(toolCatalog.mcpServerId, row.id));
    expect(catalog.map((c) => c.name).sort()).toEqual(['mcp__echo__fail', 'mcp__echo__shout']);

    // The wildcard grants every MCP tool to the admin; members need an explicit allow.
    expect((await registry.toolsFor(admin, [MCP_WILDCARD])).map((t) => t.name).sort()).toEqual([
      'mcp__echo__fail',
      'mcp__echo__shout',
    ]);
    expect(await registry.toolsFor(member, [MCP_WILDCARD])).toEqual([]);
    await db.db
      .insert(memberToolRestrictions)
      .values({ userId: member.id, toolName: 'mcp__echo__shout', allowed: true });
    expect((await registry.toolsFor(member, [MCP_WILDCARD])).map((t) => t.name)).toEqual([
      'mcp__echo__shout',
    ]);
  });

  it('records MCP connection failures instead of throwing', async () => {
    const [row] = await db.db
      .insert(mcpServers)
      .values({ name: 'broken', transport: 'stdio', command: '/nonexistent/binary', args: [], enabled: true })
      .returning();
    if (!row) throw new Error('insert failed');
    await registry.connectServer(row);
    const after = await db.db.query.mcpServers.findFirst({ where: eq(mcpServers.id, row.id) });
    expect(after?.lastError).toBeTruthy();
  });
});
