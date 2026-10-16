import { createSign, generateKeyPairSync } from 'node:crypto';
import { CognitoAccessTokenVerifier, resourceScopes } from './cognito-access-token.verifier';

const ISSUER = 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_TEST';
const RESOURCE = 'https://mcp.example.portal.example.com';
const KID = 'test-kid';
const NOW = Date.parse('2026-10-07T00:00:00Z');

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function sign(payload: Record<string, unknown>, key = pair.privateKey): string {
  const data = `${b64url({ alg: 'RS256', kid: KID, typ: 'JWT' })}.${b64url(payload)}`;
  const sig = createSign('RSA-SHA256').update(data).sign(key).toString('base64url');
  return `${data}.${sig}`;
}

function accessPayload(): Record<string, unknown> {
  return {
    iss: ISSUER,
    client_id: 'dcr-client-1',
    token_use: 'access',
    scope: `openid email ${RESOURCE}/read ${RESOURCE}/write`,
    exp: Math.floor(NOW / 1000) + 3600,
    sub: 'sub-1',
    username: 'google_1234',
    email: 'Alex@Example.com',
  };
}

function verifier(allowedEmailDomain?: string): CognitoAccessTokenVerifier {
  return new CognitoAccessTokenVerifier(
    { issuer: ISSUER, resourceIdentifier: RESOURCE, allowedEmailDomain },
    async () => [jwk as never],
    () => NOW,
  );
}

describe('CognitoAccessTokenVerifier', () => {
  it('accepts a signed access token carrying our scopes and the pre-token email', async () => {
    expect(await verifier('example.com').verify(sign(accessPayload()))).toEqual({
      kind: 'user',
      email: 'alex@example.com',
      sub: 'sub-1',
      name: null,
      scopes: ['read', 'write'],
    });
  });

  it('maps a read-only grant to scopes [read]', async () => {
    const p = await verifier().verify(sign({ ...accessPayload(), scope: `openid ${RESOURCE}/read` }));
    expect(p?.scopes).toEqual(['read']);
  });

  it('rejects tokens with none of our scopes, even when otherwise valid', async () => {
    const v = verifier();
    expect(await v.verify(sign({ ...accessPayload(), scope: 'openid email' }))).toBeNull();
    expect(await v.verify(sign({ ...accessPayload(), scope: 'https://other.example/read' }))).toBeNull();
    const { scope: _drop, ...noScope } = accessPayload();
    expect(await v.verify(sign(noScope))).toBeNull();
  });

  it('rejects ID tokens, wrong issuers, and expired tokens', async () => {
    const v = verifier();
    expect(await v.verify(sign({ ...accessPayload(), token_use: 'id' }))).toBeNull();
    expect(await v.verify(sign({ ...accessPayload(), iss: 'https://evil.example' }))).toBeNull();
    expect(await v.verify(sign({ ...accessPayload(), exp: Math.floor(NOW / 1000) - 1 }))).toBeNull();
  });

  it('accepts a missing aud (classic Cognito) but rejects an aud that is not us', async () => {
    const v = verifier();
    expect(await v.verify(sign({ ...accessPayload(), aud: RESOURCE }))).not.toBeNull();
    expect(await v.verify(sign({ ...accessPayload(), aud: [RESOURCE, 'x'] }))).not.toBeNull();
    expect(await v.verify(sign({ ...accessPayload(), aud: 'https://someone-else.example' }))).toBeNull();
  });

  it('requires an email claim and enforces the domain allowlist', async () => {
    const { email: _drop, ...noEmail } = accessPayload();
    expect(await verifier().verify(sign(noEmail))).toBeNull();
    expect(await verifier('example.com').verify(sign({ ...accessPayload(), email: 'x@other.example' }))).toBeNull();
    expect(await verifier('example.com').verify(sign({ ...accessPayload(), email: 'x@example.com.evil.tld' }))).toBeNull();
    expect(await verifier().verify(sign({ ...accessPayload(), email: 'x@other.example' }))).not.toBeNull();
  });

  it('rejects a bad signature and malformed tokens', async () => {
    const v = verifier();
    expect(await v.verify(sign(accessPayload(), other.privateKey))).toBeNull();
    expect(await v.verify('two.parts')).toBeNull();
    expect(await v.verify('')).toBeNull();
  });
});

describe('resourceScopes', () => {
  it('keeps only read/write under our resource prefix', () => {
    expect(resourceScopes(`openid ${RESOURCE}/write ${RESOURCE}/admin ${RESOURCE}x/read`, RESOURCE)).toEqual(['write']);
    expect(resourceScopes(undefined, RESOURCE)).toEqual([]);
  });
});
