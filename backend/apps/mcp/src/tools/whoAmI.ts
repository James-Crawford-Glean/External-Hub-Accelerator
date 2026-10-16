// whoAmI: the acting principal as the server sees it. The first tool to call
// when a host connects; it shows whether the connection is a signed-in user
// (OAuth) or a service key, and which capabilities the roster grants.
import { READ_ONLY } from '../mcp/annotations';
import type { ToolDefinition, ToolResult } from '../mcp/tools';
import { authz, identityService } from '../container';

export const whoAmI: ToolDefinition = {
  name: 'whoAmI',
  description:
    'Describe the acting principal: signed-in user or service key, email when known, roster role, and whether ' +
    'the connection may write. Call this first when a write tool reports that an acting user is required.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: READ_ONLY,
  async handler(_args, ctx): Promise<ToolResult> {
    const identity = ctx.identity;
    const kind = identity.kind === 'apiKey' ? 'apiKey' : 'user';
    const email = typeof identity.email === 'string' ? identity.email.toLowerCase() : null;
    const [role, isAdmin, canWrite] = await Promise.all([
      authz().roleFromIdentity(identity),
      authz().isAdminFromIdentity(identity),
      authz().canWrite(identity),
    ]);
    const userId = email ? await identityService().resolveUserIdByEmail(email) : null;
    const who = kind === 'apiKey' ? `service key ${identity.keyId ?? ''}`.trim() : (email ?? 'anonymous user');
    const text = `${who}: role ${role ?? 'none'}${isAdmin ? ' (administrator)' : ''}, ${canWrite ? 'may write' : 'read-only'}.`;
    return {
      content: [{ type: 'text', text }],
      structuredContent: { kind, email, userId, role, isAdmin, canWrite, scopes: identity.scopes ?? null },
    };
  },
};
