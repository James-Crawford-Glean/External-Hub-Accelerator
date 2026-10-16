import { assignments, bind, inClause, paginate, placeholders, type Params } from './index';

describe('sql helpers', () => {
  it('binds placeholder lists', () => {
    const params: Params = {};
    expect(placeholders(['a', 'b'], params, 'x')).toBe(':x_0, :x_1');
    expect(params).toEqual({ x_0: 'a', x_1: 'b' });
  });

  it('builds IN clauses', () => {
    const params: Params = {};
    expect(inClause('id', [1, 2], params, 'i')).toBe('id IN (:i_0, :i_1)');
  });

  it('clamps pagination', () => {
    const params: Params = {};
    paginate({ limit: 5000, offset: -3 }, params);
    expect(params).toEqual({ lim: 1000, off: 0 });
    paginate({}, params, { def: 25 });
    expect(params.lim).toBe(25);
  });

  it('binds only provided fields and applies casts', () => {
    const params: Params = {};
    const pairs = bind({ name: 'n', tags: '["a"]', skip: null }, { name: 'name', tags: 'tags', skip: 'skip' }, params, {
      tags: 'jsonb',
    });
    expect(pairs).toEqual([
      ['name', ':name'],
      ['tags', ':tags::jsonb'],
    ]);
    expect(assignments({ name: 'n' }, { name: 'name' }, {})).toEqual(['name = :name']);
  });
});
