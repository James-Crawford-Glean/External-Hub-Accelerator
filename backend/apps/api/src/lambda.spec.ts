import { dispatch, type AppSyncEvent, type ResolverFn } from './lambda';

describe('dispatch', () => {
  const table: Record<string, ResolverFn> = {
    me: async (_a, _s, identity) => ({ email: identity.email }),
    'op:glean_token': async (args) => ({ token: `t-${args.sub}` }),
  };
  const lookup = (key: string) => table[key];

  it('routes AppSync fields by fieldName', async () => {
    const event: AppSyncEvent = { fieldName: 'me', identity: { email: 'a@example.com' } };
    await expect(dispatch(event, lookup)).resolves.toEqual({ email: 'a@example.com' });
  });

  it('routes internal RPCs by op', async () => {
    const event: AppSyncEvent = { op: 'glean_token', arguments: { sub: 's1' } };
    await expect(dispatch(event, lookup)).resolves.toEqual({ token: 't-s1' });
  });

  it('fails loudly for an unregistered field', async () => {
    await expect(dispatch({ fieldName: 'nope' }, lookup)).rejects.toThrow('no resolver registered for "nope"');
  });
});
