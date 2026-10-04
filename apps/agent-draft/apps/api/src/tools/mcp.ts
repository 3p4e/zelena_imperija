import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Logger } from 'pino';
import { clip } from './define.js';
import type { Tool, ToolResult } from './types.js';

export interface McpServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command: string | null;
  args: string[];
  url: string | null;
  env: Record<string, string>;
}

interface Connection {
  client: Client;
  tools: Tool[];
}

export const MCP_TOOL_PREFIX = 'mcp__';
export const mcpToolName = (server: string, tool: string): string =>
  `${MCP_TOOL_PREFIX}${server}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

/**
 * Connects to configured MCP servers and exposes their tools through the generic
 * Tool contract. Arguments are passed through; the MCP server validates them.
 */
export class McpHub {
  private readonly connections = new Map<string, Connection>();

  constructor(private readonly log: Logger) {}

  async connect(cfg: McpServerConfig): Promise<Tool[]> {
    await this.disconnect(cfg.id);
    const client = new Client({ name: 'agent-platform', version: '0.1.0' });
    let transport: Transport;
    if (cfg.transport === 'stdio') {
      if (!cfg.command) throw new Error('stdio MCP server needs a command');
      transport = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...cfg.env },
        stderr: 'ignore',
      });
    } else {
      if (!cfg.url) throw new Error('http MCP server needs a URL');
      const headers: Record<string, string> = {};
      if (cfg.env.AUTHORIZATION) headers.authorization = cfg.env.AUTHORIZATION;
      transport = new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers } }) as Transport;
    }
    await client.connect(transport);
    const listed = await client.listTools();
    const tools = listed.tools.map((t): Tool => {
      const name = mcpToolName(cfg.name, t.name);
      return {
        name,
        description: `[${cfg.name}] ${t.description ?? t.name}`,
        inputSchema: t.inputSchema,
        permission: 'network',
        source: 'mcp',
        requiresApproval: false,
        auth: 'mcp_server',
        mcpServerId: cfg.id,
        parse: (args) => (args && typeof args === 'object' ? args : {}),
        handler: async (ctx, args): Promise<ToolResult> => {
          const res = await client.callTool(
            { name: t.name, arguments: args as Record<string, unknown> },
            undefined,
            ctx.signal ? { signal: ctx.signal, timeout: 120_000 } : { timeout: 120_000 },
          );
          const content = Array.isArray(res.content) ? res.content : [];
          const text = content
            .map((c: { type: string; text?: string }) => (c.type === 'text' ? (c.text ?? '') : `[${c.type} content]`))
            .join('\n');
          return { content: clip(text || '(empty result)'), isError: res.isError === true };
        },
      };
    });
    this.connections.set(cfg.id, { client, tools });
    this.log.info({ server: cfg.name, tools: tools.length }, 'mcp server connected');
    return tools;
  }

  async disconnect(id: string): Promise<void> {
    const c = this.connections.get(id);
    if (!c) return;
    this.connections.delete(id);
    await c.client.close().catch(() => undefined);
  }

  tools(): Tool[] {
    return [...this.connections.values()].flatMap((c) => c.tools);
  }

  async closeAll(): Promise<void> {
    for (const id of [...this.connections.keys()]) await this.disconnect(id);
  }
}
