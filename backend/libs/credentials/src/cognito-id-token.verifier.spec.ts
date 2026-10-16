import { createSign, generateKeyPairSync } from 'node:crypto';
import { CognitoJwtVerifier } from './cognito-id-token.verifier';

const ISSUER = 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_TEST';
const CLIENT_ID = 'spa-client-123';
const KID = 'test-kid';
const NOW = Date.parse('2026-07-08T00:00:00Z');

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function sign(
  payload: Record<string, unknown>,
  opts: { alg?: string; kid?: string; key?: (typeof pair)['privateKey'] } = {},
): string {
  const header = { alg: opts.alg ?? 'RS256', kid: opts.kid ?? KID, typ: 'JWT' };
  const data = `${b64url(header)}.${b64url(payload)}`;
  const sig = createSign('RSA-SHA256')
    .update(data)
    .sign(opts.key ?? pair.privateKey)
    .toString('base64url');
  return `${data}.${sig}`;
}

function validPayload(): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: CLIENT_ID,
    token_use: 'id',
    exp: Math.floor(NOW / 1000) + 3600,
    email: 'Alex@Example.com',
    name: 'Alex M',
    sub: 'sub-1',
  };
}

function verifier(): CognitoJwtVerifier {
  return new CognitoJwtVerifier(
    { issuer: ISSUER, clientId: CLIENT_ID },
    async () => [jwk as never],
    () => NOW,
  );
}

function gleanOnlyVerifier(): CognitoJwtVerifier {
  return new CognitoJwtVerifier(
    { issuer: ISSUER, clientId: CLIENT_ID, allowedEmailDomain: 'example.com' },
    async () => [jwk as never],
    () => NOW,
  );
}

describe('CognitoJwtVerifier', () => {
  it('accepts a valid Cognito ID token and lowercases the email', async () => {
    expect(await verifier().verify(sign(validPayload()))).toEqual({
      kind: 'user',
      email: 'alex@example.com',
      sub: 'sub-1',
      name: 'Alex M',
    });
  });

  it('rejects wrong audience, issuer, and token_use', async () => {
    const v = verifier();
    expect(await v.verify(sign({ ...validPayload(), aud: 'someone-else' }))).toBeNull();
    expect(await v.verify(sign({ ...validPayload(), iss: 'https://evil.example' }))).toBeNull();
    expect(await v.verify(sign({ ...validPayload(), token_use: 'access' }))).toBeNull();
  });

  it('rejects an expired token', async () => {
    expect(await verifier().verify(sign({ ...validPayload(), exp: Math.floor(NOW / 1000) - 1 }))).toBeNull();
  });

  it('rejects a non-RS256 alg and an unknown kid', async () => {
    const v = verifier();
    expect(await v.verify(sign(validPayload(), { alg: 'HS256' }))).toBeNull();
    expect(await v.verify(sign(validPayload(), { kid: 'rotated-away' }))).toBeNull();
  });

  it('rejects a signature made with a different key', async () => {
    expect(await verifier().verify(sign(validPayload(), { key: other.privateKey }))).toBeNull();
  });

  it('rejects malformed tokens', async () => {
    const v = verifier();
    expect(await v.verify('not.a.jwt.at.all')).toBeNull();
    expect(await v.verify('two.parts')).toBeNull();
    expect(await v.verify('')).toBeNull();
  });

  describe('allowedEmailDomain (only @example.com)', () => {
    it('accepts a example.com email (case-insensitive) when the domain is enforced', async () => {
      expect(await gleanOnlyVerifier().verify(sign(validPayload()))).toEqual({
        kind: 'user',
        email: 'alex@example.com',
        sub: 'sub-1',
        name: 'Alex M',
      });
    });

    it('rejects an otherwise-valid token whose email is not at example.com', async () => {
      const v = gleanOnlyVerifier();
      expect(await v.verify(sign({ ...validPayload(), email: 'user@other.example' }))).toBeNull();
      // suffix-spoof: a look-alike domain must not slip past the @domain tail match.
      expect(await v.verify(sign({ ...validPayload(), email: 'attacker@example.com.evil.tld' }))).toBeNull();
      expect(await v.verify(sign({ ...validPayload(), email: 'outsider@other.example' }))).toBeNull();
    });

    it('rejects a token with no email claim when the domain is enforced', async () => {
      const { email: _drop, ...noEmail } = validPayload();
      expect(await gleanOnlyVerifier().verify(sign(noEmail))).toBeNull();
    });

    it('does not restrict by domain when allowedEmailDomain is unset (seam is opt-in)', async () => {
      const anyDomain = await verifier().verify(sign({ ...validPayload(), email: 'user@other.example' }));
      expect(anyDomain).toMatchObject({ kind: 'user', email: 'user@other.example' });
    });
  });
});
