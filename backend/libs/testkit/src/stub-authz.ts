// Test-only AuthzService stub. Defaults to an admin caller so specs assert over
// the full data set; pass a Visibility to simulate a scoped caller. Covers every
// method the resolvers call.
import type { AuthzService, Visibility } from '@libs/authz';

export function stubAuthz(vis: Visibility = { role: null, isAdmin: true }): AuthzService {
  return {
    visibilityFor: async () => vis,
    canAccess: (v: Visibility, role: string | null | undefined) => v.isAdmin || role == null || v.role === role,
    requireUser: () => undefined,
    requireRead: () => undefined,
    requireWrite: async () => undefined,
    requireAdmin: async () => undefined,
    canWrite: async () => true,
    isAdminFromIdentity: async () => vis.isAdmin,
    roleFromIdentity: async () => vis.role,
  } as unknown as AuthzService;
}
