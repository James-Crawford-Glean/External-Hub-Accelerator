import { parseScopes, principalFromContext } from './types';

describe('parseScopes', () => {
  it('splits a comma-separated string and drops unknown values', () => {
    expect(parseScopes('read,write,admin')).toEqual(['read', 'write', 'admin']);
    expect(parseScopes('read, bogus , write')).toEqual(['read', 'write']);
    expect(parseScopes('')).toEqual([]);
  });

  it('accepts an array too', () => {
    expect(parseScopes(['read', 'admin'])).toEqual(['read', 'admin']);
  });

  it('is empty for null/undefined', () => {
    expect(parseScopes(null)).toEqual([]);
    expect(parseScopes(undefined)).toEqual([]);
  });
});

describe('principalFromContext', () => {
  it('builds an apiKey principal with scopes parsed from the CSV context', () => {
    expect(principalFromContext({ kind: 'apiKey', keyId: 'apk_1', scopes: 'read,write' })).toEqual({
      kind: 'apiKey',
      keyId: 'apk_1',
      scopes: ['read', 'write'],
    });
  });

  it('builds a user principal from an explicit user context, lowercasing email', () => {
    expect(principalFromContext({ kind: 'user', email: 'Alex@Example.com', sub: 's1', name: 'Alex M' })).toEqual({
      kind: 'user',
      email: 'alex@example.com',
      sub: 's1',
      name: 'Alex M',
    });
  });

  it('treats a legacy email/sub identity (no kind) as a user', () => {
    expect(principalFromContext({ email: 'a@example.com' })).toEqual({
      kind: 'user',
      email: 'a@example.com',
      sub: '',
      name: null,
    });
    expect(principalFromContext({ sub: 'cognito-sub' })).toEqual({
      kind: 'user',
      email: '',
      sub: 'cognito-sub',
      name: null,
    });
  });

  it('returns null when there is no principal', () => {
    expect(principalFromContext({})).toBeNull();
    expect(principalFromContext(null)).toBeNull();
  });
});
