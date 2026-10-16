import { authorize } from './authorize';
import type { Principal } from '@libs/credentials';

const USER: Principal = { kind: 'user', email: 'a@example.com', sub: 's1', name: 'Ann' };
const KEY: Principal = { kind: 'apiKey', keyId: 'apk_1', scopes: ['read', 'write'] };

describe('authorize (AppSync)', () => {
  it('authorizes a user token and returns a cacheable resolverContext', async () => {
    const verify = jest.fn(async () => USER);
    const res = await authorize({ authorizationToken: 'Bearer jwt' }, verify);

    expect(verify).toHaveBeenCalledWith('Bearer jwt');
    expect(res).toEqual({
      isAuthorized: true,
      resolverContext: { kind: 'user', email: 'a@example.com', sub: 's1', name: 'Ann' },
      ttlOverride: 60,
    });
  });

  it('denies with an empty context and no caching when verification fails', async () => {
    const verify = jest.fn(async () => null);
    const res = await authorize({ authorizationToken: 'Bearer bad' }, verify);
    expect(res).toEqual({ isAuthorized: false, resolverContext: {}, ttlOverride: 0 });
  });
});

describe('authorize (API Gateway v2)', () => {
  it('reads the bearer from identitySource and returns a key context', async () => {
    const verify = jest.fn(async () => KEY);
    const res = await authorize(
      { version: '2.0', type: 'REQUEST', identitySource: ['Bearer psk_live_x'], headers: {} },
      verify,
    );

    expect(verify).toHaveBeenCalledWith('Bearer psk_live_x');
    expect(res).toEqual({ isAuthorized: true, context: { kind: 'apiKey', keyId: 'apk_1', scopes: 'read,write' } });
  });

  it('falls back to the Authorization header when identitySource is absent', async () => {
    const verify = jest.fn(async () => USER);
    await authorize({ type: 'REQUEST', headers: { authorization: 'Bearer h' } }, verify);
    expect(verify).toHaveBeenCalledWith('Bearer h');
  });

  it('denies with an empty context', async () => {
    const verify = jest.fn(async () => null);
    const res = await authorize({ type: 'REQUEST', headers: {} }, verify);
    expect(res).toEqual({ isAuthorized: false, context: {} });
    expect(verify).not.toHaveBeenCalled();
  });
});
