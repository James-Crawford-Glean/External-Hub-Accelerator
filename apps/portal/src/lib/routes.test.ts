import { describe, expect, it } from 'vitest';
import { routeIdOf } from './routes';

// BASENAME is '/' under vitest (BASE_URL defaults to '/'), so paths here are basename-free.
describe('routeIdOf', () => {
  it('passes static routes through as their own page id', () => {
    expect(routeIdOf('/')).toEqual({ pageId: '/' });
    expect(routeIdOf('/items')).toEqual({ pageId: '/items' });
    expect(routeIdOf('/admin/api-keys')).toEqual({ pageId: '/admin/api-keys' });
  });

  it('templates dynamic segments and reports the entity', () => {
    expect(routeIdOf('/items/itm_abc123')).toEqual({ pageId: '/items/:id', entityType: 'item', entityId: 'itm_abc123' });
  });

  it('collapses every entity of a route onto one page id', () => {
    const ids = ['/items/a', '/items/b', '/items/c'].map((p) => routeIdOf(p).pageId);
    expect(new Set(ids).size).toBe(1);
  });

  it('falls back to the raw path when no route matches', () => {
    expect(routeIdOf('/not/a/route')).toEqual({ pageId: '/not/a/route' });
  });
});
