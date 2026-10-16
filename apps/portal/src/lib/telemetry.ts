// CloudWatch RUM client shim. This is the one module that knows about aws-rum-web; the rest
// of the app calls the typed record* helpers. Best-effort throughout — telemetry must never
// throw into a user action, and it is a silent no-op unless an app monitor is configured
// (RUM_ENABLED false: local dev stays dark).
//
// PII note: unlike gleanLog (strictly non-PII), RUM session attributes deliberately carry
// userId + email + name so slowness can be traced to a specific user.
// Event payloads still avoid free text — send lengths and counts, never query strings.
import { AwsRum } from 'aws-rum-web';
import {
  APP_ENV,
  APP_VERSION,
  RUM_APP_MONITOR_ID,
  RUM_ENABLED,
  RUM_IDENTITY_POOL_ID,
  RUM_REGION,
} from './api/config';
import { routeIdOf } from './routes';

type RumConfig = ConstructorParameters<typeof AwsRum>[3];

let rum: AwsRum | undefined;

/** RUM caps custom attribute values at 256 chars (longer ones are dropped, not trimmed). */
const cap = (value: string): string => value.slice(0, 256);

export function initTelemetry(): void {
  if (rum || !RUM_ENABLED) return;
  try {
    const config: RumConfig = {
      sessionSampleRate: 1,
      identityPoolId: RUM_IDENTITY_POOL_ID,
      endpoint: `https://dataplane.rum.${RUM_REGION}.amazonaws.com`,
      telemetries: ['errors', 'performance', 'http'],
      allowCookies: true,
      enableXRay: false,
      // We drive page views ourselves: the pageId is templated (/items/:id) so per-page
      // rollups aggregate, and only a manual page view can carry attributes — the concrete
      // path/entity ride along there, the live url on the event hook. See recordPage.
      disableAutoPageView: true,
      // Release correlation: env + git SHA on every event, incl. built-in web vitals.
      // Key is `release` (not `version`) to avoid colliding with RUM's built-in `version`
      // metadata (the schema version), which would shadow ours.
      sessionAttributes: { env: APP_ENV, release: APP_VERSION },
      // Omit guestRoleArn: that would force the basic/classic auth flow, which the identity
      // pool doesn't enable. Enhanced flow (GetCredentialsForIdentity) resolves the unauth
      // role via the pool's role attachment — AWS-recommended and needs no STS.
    };
    rum = new AwsRum(RUM_APP_MONITOR_ID, APP_VERSION, RUM_REGION, config);
    // Live URL on every event, not just page views. Page attributes are frozen at the page
    // view that recorded them, so a filter applied afterwards (?q=, ?status=) wouldn't show
    // up on the error or slow fetch it caused — this hook resolves the href per event, so an
    // issue is always drillable back to the exact URL that produced it.
    rum.setEventMetadataHook(() => ({ url: cap(location.href) }));
    console.info(`[rum] initialized monitor=${RUM_APP_MONITOR_ID} env=${APP_ENV} version=${APP_VERSION}`);
  } catch (e) {
    // Surface init failures — a swallowed error here means silent zero telemetry.
    console.error('[rum] init failed', e);
    rum = undefined; // never block app boot
  }
}

export interface TelemetryUser {
  userId?: string;
  email?: string;
  name?: string;
}

export function setTelemetryUser(user: TelemetryUser): void {
  if (!rum) return;
  const attrs: Record<string, string> = {};
  if (user.userId) attrs.userId = user.userId;
  if (user.email) attrs.email = user.email;
  if (user.name) attrs.name = user.name;
  if (!Object.keys(attrs).length) return;
  try {
    rum.addSessionAttributes(attrs);
  } catch {
    /* best-effort */
  }
}

export function recordEvent(type: string, data: Record<string, string | number | boolean>): void {
  if (!rum) return;
  try {
    rum.recordEvent(type, data);
  } catch {
    /* best-effort */
  }
}

let lastPath: string | undefined;

/**
 * Record a page view: templated id + the concrete path as metadata. Deduped on pathname, so
 * filter query-param churn (`?q=`, `?tab=`) doesn't inflate the view count — a real navigation
 * between two entities of the same route still counts twice. The query string isn't lost:
 * the event metadata hook stamps the live `url` on every event (see initTelemetry).
 *
 * Attribute budget is 10 per event, shared with session attributes: env + release + userId +
 * email + name (5) leaves 5, spent on url (hook) + up to 3 here.
 */
export function recordPage(pathname: string): void {
  if (!rum || pathname === lastPath) return;
  lastPath = pathname;
  const { pageId, entityType, entityId } = routeIdOf(pathname);
  // `path` is the copy/paste debug handle: route + real ids, no filter noise.
  const pageAttributes: Record<string, string> = { path: cap(pathname) };
  if (entityType && entityId) {
    pageAttributes.entityType = entityType;
    pageAttributes.entityId = cap(entityId);
  }
  try {
    rum.recordPageView({ pageId, pageAttributes });
  } catch {
    /* best-effort */
  }
}

// ---- Typed application events --------------------------------------------
export const recordGqlRequest = (d: { op: string; durationMs: number; ok: boolean; requestId: string }): void =>
  recordEvent('gql_request', { ...d, durationMs: Math.round(d.durationMs) });

export const recordDropdownOpen = (d: { picker: string; openToOptionsMs: number; count: number }): void =>
  recordEvent('dropdown_open', { ...d, openToOptionsMs: Math.round(d.openToOptionsMs) });

/** Sub-tab view within a page whose route doesn't change. recordPage dedupes on
 *  pathname only, so these query-param switches wouldn't otherwise fire. */
export const recordTabView = (d: { page: string; tab: string }): void => recordEvent('tab_view', d);

export const recordSearch = (d: { surface: string; queryLen: number; durationMs: number; resultCount: number }): void =>
  recordEvent('search', { ...d, durationMs: Math.round(d.durationMs) });

/** Paths in, templated route ids out, so transition timings group by the same key as page views. */
export const recordRouteTransition = (d: { route: string; fromRoute: string; durationMs: number }): void =>
  recordEvent('route_transition', {
    route: routeIdOf(d.route).pageId,
    fromRoute: routeIdOf(d.fromRoute).pageId,
    durationMs: Math.round(d.durationMs),
  });
