// Reusable Glean re-auth capability, shared across every Glean-backed workflow.
// Two responsibilities:
//   1. Classify an error into a Glean auth code, whatever transport it came from
//      — the SSE stream carries a structured code on GleanStreamError; GraphQL
//      only forwards the message, so we parse that too.
//   2. Surface a single, consistent "Reconnect Glean" affordance that routes the
//      user through the per-user OAuth flow and returns them to where they were.
//
// Non-admins included: the connect mutation is per-user server-side, so this
// never depends on the admin-only Glean settings page.

import { GleanStreamError, normalizeGleanCode, reconnectGlean, type GleanErrorCode, type GleanReturn } from './glean';
import { showToast } from '../../state/toast';

/** Codes that mean the user must (re)authorize before Glean will work again. */
const RECONNECT_CODES: readonly GleanErrorCode[] = ['NOT_CONNECTED', 'RECONNECT_REQUIRED', 'TENANT_MISMATCH'];

/** Map a raw backend error message to a Glean code. Prefers an explicit token
 *  if present, else recognizes the human sentences the backend uses (avatar
 *  sync's "Connect Glean first", accessToken's "not connected" / "reconnect
 *  required"). Centralized so callers never string-match inline. */
export function gleanCodeFromMessage(raw: string): GleanErrorCode | null {
  const token = /glean:(NOT_CONNECTED|RECONNECT_REQUIRED|TENANT_MISMATCH|TRANSIENT)/i.exec(raw);
  if (token) return normalizeGleanCode(token[1]!.toUpperCase());
  const m = raw.toLowerCase();
  if (m.includes('reconnect required') || m.includes('refresh failed')) return 'RECONNECT_REQUIRED';
  if (m.includes('connect glean') || m.includes('not connected')) return 'NOT_CONNECTED';
  return null;
}

/** The reconnect-worthy Glean code carried by `err` (from either transport), or
 *  null when it isn't a Glean auth failure the user can fix by re-authorizing. */
export function gleanReconnectCode(err: unknown): GleanErrorCode | null {
  if (err instanceof GleanStreamError && err.code) {
    return RECONNECT_CODES.includes(err.code) ? err.code : null;
  }
  if (err instanceof Error) {
    const code = gleanCodeFromMessage(err.message);
    return code && RECONNECT_CODES.includes(code) ? code : null;
  }
  return null;
}

function reconnectMessage(code: GleanErrorCode): string {
  return code === 'NOT_CONNECTED'
    ? 'Connect Glean to ask questions from your knowledge.'
    : 'Your Glean session expired. Reconnect to continue.';
}

/** Surface the shared "Reconnect Glean" toast. Clicking it starts the per-user
 *  OAuth flow and returns to `returnTo`. */
export function promptGleanReconnect(opts: { returnTo: GleanReturn; code?: GleanErrorCode | null }): void {
  const code = opts.code ?? 'RECONNECT_REQUIRED';
  showToast(reconnectMessage(code), 'danger', {
    label: 'Reconnect Glean',
    onAction: () => void reconnectGlean(opts.returnTo),
  });
}
