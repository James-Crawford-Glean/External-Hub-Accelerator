// Client-side capability gates derived from `me`. These shape navigation and
// hide controls; the server enforces the same rules on every call.
import type { Me } from './api/identity';

export const canWrite = (me: Me | null): boolean => Boolean(me && (me.isAdmin || me.role === 'ADMINISTRATOR' || me.role === 'EDITOR'));
export const canAdmin = (me: Me | null): boolean => Boolean(me?.isAdmin);
