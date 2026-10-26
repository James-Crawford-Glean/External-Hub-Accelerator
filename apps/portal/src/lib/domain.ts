// What a domain contributes to the shell. The shell (App, Sidebar, TopBar, Home,
// telemetry routes) reads one registration, `DOMAIN` from src/domain.tsx, and
// never imports a domain's own files. An empty registration is a valid portal.
import type { ComponentType, ReactElement, ReactNode } from 'react';

export interface DomainRoute {
  path: string;
  element: ReactElement;
  /** Entity kind addressed by the route's `:id`, for telemetry page ids (`/things/:id`). */
  entity?: string;
}

export interface DomainNavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

export interface DomainRegistration {
  routes: readonly DomainRoute[];
  /** Sidebar entries, placed after Home in the Workspace section. */
  nav: readonly DomainNavItem[];
  /** Breadcrumb labels by path segment (`items` -> "Items"). */
  crumbLabels: Readonly<Record<string, string>>;
  /** Breadcrumb label for an id segment (`itm_…` -> "Item"); undefined falls back to the raw segment. */
  crumbLabelForId?: (segment: string) => string | undefined;
  /** Metric cards for the home grid, rendered before the Glean connection card. */
  HomeMetrics?: ComponentType;
  /** The home card beside "Ask Glean". */
  HomePanel?: ComponentType;
}

export const EMPTY_DOMAIN: DomainRegistration = { routes: [], nav: [], crumbLabels: {} };
