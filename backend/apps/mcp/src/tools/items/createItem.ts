// createItem: the example domain's create tool. An assistant-initiated create
// never goes live directly. The row lands as DRAFT under the acting user, who
// gets a notification and approves or rejects it in the web app. The host's
// confirmation panel (CREATES_RECORDS annotation) is the first gate; the
// server-side DRAFT state is the one that holds. Idempotent on acting user +
// name: a retried call returns the pending draft rather than drafting twice.
import { CREATES_RECORDS } from '../../mcp/annotations';
import type { ToolDefinition, ToolResult } from '../../mcp/tools';
import { itemsResolver } from './resolver';
import { str, textResult } from '../format';
import { CURRENT_USER_EMAIL } from './updateItem';

export const createItem: ToolDefinition = {
  name: 'createItem',
  description:
    'Create an item as a DRAFT for the acting user to review. Nothing is published until they approve it in the ' +
    'portal (Items → Drafts, or the notification bell). Confirm name and category with the user before calling.',
  inputSchema: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string' },
      category: { type: 'string' },
      description: { type: 'string' },
      website: { type: 'string', description: 'Domain only, e.g. example.com.' },
      currentUserEmail: CURRENT_USER_EMAIL,
    },
    additionalProperties: false,
  },
  annotations: CREATES_RECORDS,
  async handler(args, ctx): Promise<ToolResult> {
    const identity = ctx.identity.email
      ? ctx.identity
      : str(args.currentUserEmail)
        ? { ...ctx.identity, email: str(args.currentUserEmail) }
        : null;
    if (!identity) {
      return textResult('currentUserEmail is required: this connection has no signed-in user to own the draft.', true);
    }
    const name = str(args.name).trim();
    if (!name) return textResult('name is required.', true);
    const input = {
      name,
      category: str(args.category) || null,
      description: str(args.description) || null,
      website: str(args.website).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null,
    };
    try {
      const { item, created } = await itemsResolver().draftItem({ input }, null, identity);
      const base = (process.env.PORTAL_APP_URL ?? '').replace(/\/+$/, '');
      const link = base ? ` (${base}/items/${item.id})` : '';
      const text = created
        ? `Drafted ${item.name} (${item.id}) as DRAFT, owned by ${identity.email}. It is not published: approve it in the ` +
          `portal to make it live${link}.`
        : `Already drafted (idempotent): ${item.name} (${item.id}) is awaiting review by ${identity.email}${link}. ` +
          'No second draft was created.';
      return {
        content: [{ type: 'text', text }],
        structuredContent: {
          record: item,
          status: 'DRAFT',
          idempotent: !created,
          ...(base ? { url: `${base}/items/${item.id}` } : {}),
        },
      };
    } catch (e) {
      return textResult(e instanceof Error ? e.message : 'create failed', true);
    }
  },
};
