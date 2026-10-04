// Minimal MCP server over stdio used by the tool-registry tests.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'echo', version: '1.0.0' });
server.registerTool(
  'shout',
  { description: 'Upper-cases text', inputSchema: { text: z.string() } },
  async ({ text }) => ({ content: [{ type: 'text', text: `${text.toUpperCase()} (token=${process.env.ECHO_TOKEN ?? 'none'})` }] }),
);
server.registerTool('fail', { description: 'Always fails', inputSchema: {} }, async () => ({
  content: [{ type: 'text', text: 'nope' }],
  isError: true,
}));
await server.connect(new StdioServerTransport());
