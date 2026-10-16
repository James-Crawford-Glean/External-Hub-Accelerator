// Templated routes for telemetry. A RUM page id is an aggregation key (every per-page
// percentile is a GROUP BY on it), so concrete ids never belong in one: /items/itm_abc
// reports as /items/:id and the entity travels as metadata instead. Same normalization
// feeds route_transition so route timings and page rollups count the same populations.
import { matchRoutes } from 'react-router-dom';

/** Deploy base the router is mounted under ('/<app>' live, '/' in dev and tests). */
export const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

interface RouteSpec {
  path: string;
  /** entity kind addressed by the route's id param, when it addresses one */
  entity?: string;
}

// Mirrors App.tsx. A route missing here still reports (raw path), it just doesn't collapse.
const ROUTES: RouteSpec[] = [
  { path: '/' },
  { path: '/items' },
  { path: '/items/:id', entity: 'item' },
  { path: '/users' },
  { path: '/admin' },
  { path: '/admin/roles' },
  { path: '/admin/api-keys' },
  { path: '/admin/glean' },
  { path: '/admin/login-activity' },
  { path: '/admin/aws' },
  { path: '/glean/callback' },
];

export interface RouteId {
  /** low-cardinality aggregation key — the RUM page id */
  pageId: string;
  entityType?: string;
  entityId?: string;
}

const stripBase = (path: string): string =>
  BASENAME !== '/' && path.startsWith(BASENAME) ? path.slice(BASENAME.length) || '/' : path;

/** Templated page id plus the entity a dynamic route addresses. An unmatched path falls back
 *  to its raw (basename-stripped) form, so a new route degrades to noisy rather than silent. */
export function routeIdOf(pathname: string): RouteId {
  const leaf = matchRoutes(ROUTES, pathname, BASENAME)?.at(-1);
  if (!leaf?.route.path) return { pageId: stripBase(pathname) };
  const entityId = Object.values(leaf.params).find(Boolean);
  return leaf.route.entity && entityId
    ? { pageId: leaf.route.path, entityType: leaf.route.entity, entityId }
    : { pageId: leaf.route.path };
}
