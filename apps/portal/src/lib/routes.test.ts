import { describe, expect, it, vi } from 'vitest';
import { routeIdOf } from './routes';

// A synthetic domain so the test does not depend on whichever example is installed.
vi.mock('../domain', () => ({
  DOMAIN: {
    routes: [
      { path: '/things', element: null },
      { path: '/things/:id', element: null, entity: 'thing' },
    ],
    nav: [],
    crumbLabels: {},
  },
}));

// BASENAME is '/' under vitest (BASE_URL defaults to '/'), so paths here are basename-free.
describe('routeIdOf', () => {
  it('passes static routes through as their own page id', () => {
    expect(routeIdOf('/')).toEqual({ pageId: '/' });
    expect(routeIdOf('/things')).toEqual({ pageId: '/things' });
    expect(routeIdOf('/admin/api-keys')).toEqual({ pageId: '/admin/api-keys' });
  });

  it('templates dynamic segments and reports the entity', () => {
    expect(routeIdOf('/things/thg_abc123')).toEqual({ pageId: '/things/:id', entityType: 'thing', entityId: 'thg_abc123' });
  });

  it('collapses every entity of a route onto one page id', () => {
    const ids = ['/things/a', '/things/b', '/things/c'].map((p) => routeIdOf(p).pageId);
    expect(new Set(ids).size).toBe(1);
  });

  it('falls back to the raw path when no route matches', () => {
    expect(routeIdOf('/not/a/route')).toEqual({ pageId: '/not/a/route' });
  });
});
