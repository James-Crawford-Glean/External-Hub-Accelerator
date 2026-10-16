// listUsers: who uses this portal. Reuses the API's UsersResolver so the MCP
// surface and the GraphQL surface cannot disagree.
import { READ_ONLY } from '../mcp/annotations';
import type { ToolDefinition, ToolResult } from '../mcp/tools';
import { resolvers } from '../container';
import { str } from './format';

export const listUsers: ToolDefinition = {
  name: 'listUsers',
  description: 'List portal users, optionally filtered by a name or email fragment. Returns id, name, email, title, and role.',
  inputSchema: {
    type: 'object',
    properties: {
      search: { type: 'string', description: 'Case-insensitive fragment matched against name and email.' },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max rows (default 25).' },
    },
    additionalProperties: false,
  },
  annotations: READ_ONLY,
  async handler(args, ctx): Promise<ToolResult> {
    const limit = typeof args.limit === 'number' ? args.limit : 25;
    const res = await resolvers.users().users({ search: str(args.search), limit }, null, ctx.identity);
    const lines = res.items.map((u) => `- ${u.name} <${u.email}>${u.title ? `, ${u.title}` : ''}${u.role ? ` [${u.role}]` : ''}`);
    const text = res.total === 0 ? 'No users matched.' : `${res.total} user(s); showing ${res.items.length}.\n${lines.join('\n')}`;
    return {
      content: [{ type: 'text', text }],
      structuredContent: { total: res.total, rows: res.items, truncated: res.items.length < res.total },
    };
  },
};
