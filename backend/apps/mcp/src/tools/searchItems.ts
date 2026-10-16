// searchItems: the example domain's read tool. Reuses the API's ItemsResolver
// so the MCP and GraphQL surfaces cannot disagree, and so the caller's roster
// visibility applies identically.
import { LIVE_STATUSES, type ItemStatus } from '@libs/items';
import { READ_ONLY } from '../mcp/annotations';
import type { ToolDefinition, ToolResult } from '../mcp/tools';
import { resolvers } from '../container';
import { str, strArray } from './format';

export const searchItems: ToolDefinition = {
  name: 'searchItems',
  description:
    'Search items by name, description, or website, optionally filtered by status and category. Returns id, name, ' +
    'category, status, owner, website, and a link into the portal. Use the returned id with updateItem.',
  inputSchema: {
    type: 'object',
    properties: {
      search: { type: 'string', description: 'Case-insensitive fragment matched against name, description, website.' },
      status: { type: 'array', items: { type: 'string', enum: ['ACTIVE', 'ARCHIVED'] } },
      category: { type: 'array', items: { type: 'string' } },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max rows (default 25).' },
    },
    additionalProperties: false,
  },
  annotations: READ_ONLY,
  async handler(args, ctx): Promise<ToolResult> {
    const limit = typeof args.limit === 'number' ? args.limit : 25;
    // The assistant reads live rows only; DRAFT / REJECTED are reviewed in the portal, never searched from here.
    const status = strArray(args.status).filter((s): s is ItemStatus => (LIVE_STATUSES as readonly string[]).includes(s));
    const filter = { search: str(args.search), status, category: strArray(args.category) };
    const res = await resolvers.items().items({ filter, limit }, null, ctx.identity);
    const base = (process.env.PORTAL_APP_URL ?? '').replace(/\/+$/, '');
    const rows = res.items.map((i) => ({ ...i, url: base ? `${base}/items/${i.id}` : null }));
    const lines = rows.map(
      (i) => `- ${i.name} (${i.id})${i.category ? `, ${i.category}` : ''}${i.status !== 'ACTIVE' ? ` [${i.status}]` : ''}${i.owner ? `, owner ${i.owner.name}` : ''}`,
    );
    const text = res.total === 0 ? 'No items matched.' : `${res.total} item(s); showing ${rows.length}.\n${lines.join('\n')}`;
    return {
      content: [{ type: 'text', text }],
      structuredContent: { total: res.total, rows, truncated: rows.length < res.total },
    };
  },
};
