// updateItem: the example domain's write tool. Approval-gated on the host side
// by its annotations (not read-only), and on the server side by requireWrite
// plus the acting-user rule: a connection with no signed-in user must supply
// currentUserEmail, or the write fails rather than being attributed to nobody.
import { UPDATES_IN_PLACE } from '../../mcp/annotations';
import type { ToolDefinition, ToolResult } from '../../mcp/tools';
import { itemsResolver } from './resolver';
import { str, textResult } from '../format';

export const CURRENT_USER_EMAIL = {
  type: 'string',
  description:
    'Only needed when the connection has no signed-in user (service-key connections). With a signed-in connection ' +
    'the acting user comes from the token and this value is ignored. Do not ask for it unless a tool error says it is missing.',
} as const;

export const updateItem: ToolDefinition = {
  name: 'updateItem',
  description:
    'Update one item by id: name, category, description, website, or status (ACTIVE | ARCHIVED). Confirm the intended ' +
    'change with the user before calling; the change is recorded under the acting user.',
  inputSchema: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: 'Item id (itm_...) from searchItems.' },
      name: { type: 'string' },
      category: { type: 'string' },
      description: { type: 'string' },
      website: { type: 'string' },
      status: { type: 'string', enum: ['ACTIVE', 'ARCHIVED'] },
      currentUserEmail: CURRENT_USER_EMAIL,
    },
    additionalProperties: false,
  },
  annotations: UPDATES_IN_PLACE,
  async handler(args, ctx): Promise<ToolResult> {
    const identity = ctx.identity.email
      ? ctx.identity
      : str(args.currentUserEmail)
        ? { ...ctx.identity, email: str(args.currentUserEmail) }
        : null;
    if (!identity) {
      return textResult('currentUserEmail is required: this connection has no signed-in user to attribute the change to.', true);
    }
    const id = str(args.id);
    if (!id) return textResult('id is required.', true);
    const input: Record<string, unknown> = {};
    for (const k of ['name', 'category', 'description', 'website', 'status'] as const) if (args[k] !== undefined) input[k] = args[k];
    if (Object.keys(input).length === 0) return textResult('Nothing to change: pass at least one field.', true);
    try {
      const item = await itemsResolver().updateItem({ id, input }, null, identity);
      return {
        content: [{ type: 'text', text: `Updated ${item.name} (${item.id}): ${Object.keys(input).join(', ')}.` }],
        structuredContent: { record: item, changed: Object.keys(input) },
      };
    } catch (e) {
      return textResult(e instanceof Error ? e.message : 'update failed', true);
    }
  },
};
