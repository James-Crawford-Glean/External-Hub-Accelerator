import { CredentialService } from './credential.service';
import type { ApiKeyService } from './api-key.service';
import type { JwtVerifier, UserPrincipal } from './types';

function makeService(): {
  svc: CredentialService;
  verifyKey: jest.Mock;
  verifyJwt: jest.Mock;
} {
  const verifyKey = jest.fn(async () => ({ kind: 'apiKey', keyId: 'apk_1', scopes: ['read'] }));
  const verifyJwt = jest.fn(async (): Promise<UserPrincipal> => ({ kind: 'user', email: 'a@example.com', sub: 's', name: 'A' }));
  const keys = { verifyKey } as unknown as ApiKeyService;
  const jwt = { verify: verifyJwt } as unknown as JwtVerifier;
  return { svc: new CredentialService(keys, jwt), verifyKey, verifyJwt };
}

describe('CredentialService.verify', () => {
  it('routes psk_ tokens to the key verifier (and strips Bearer)', async () => {
    const { svc, verifyKey, verifyJwt } = makeService();

    await svc.verify('Bearer psk_live_abc');
    expect(verifyKey).toHaveBeenCalledWith('psk_live_abc');
    expect(verifyJwt).not.toHaveBeenCalled();
  });

  it('routes bare psk_ tokens (no Bearer prefix) to the key verifier', async () => {
    const { svc, verifyKey } = makeService();
    await svc.verify('psk_live_abc');
    expect(verifyKey).toHaveBeenCalledWith('psk_live_abc');
  });

  it('routes anything else to the JWT verifier', async () => {
    const { svc, verifyKey, verifyJwt } = makeService();

    await svc.verify('Bearer eyJhbGciOi.J.WT');
    expect(verifyJwt).toHaveBeenCalledWith('eyJhbGciOi.J.WT');
    expect(verifyKey).not.toHaveBeenCalled();
  });

  describe('token_use dispatch', () => {
    const jwtWith = (claims: Record<string, unknown>): string =>
      `${Buffer.from('{"alg":"RS256","kid":"k"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

    function makeDual() {
      const verifyId = jest.fn(async () => null);
      const verifyAccess = jest.fn(async () => null);
      const svc = new CredentialService(null, { verify: verifyId }, { verify: verifyAccess });
      return { svc, verifyId, verifyAccess };
    }

    it('sends token_use=access to the access-token verifier only', async () => {
      const { svc, verifyId, verifyAccess } = makeDual();
      const token = jwtWith({ token_use: 'access' });
      await svc.verify(`Bearer ${token}`);
      expect(verifyAccess).toHaveBeenCalledWith(token);
      expect(verifyId).not.toHaveBeenCalled();
    });

    it('sends token_use=id (and unreadable payloads) to the ID-token verifier', async () => {
      const { svc, verifyId, verifyAccess } = makeDual();
      await svc.verify(jwtWith({ token_use: 'id' }));
      await svc.verify('garbage.??.sig');
      expect(verifyId).toHaveBeenCalledTimes(2);
      expect(verifyAccess).not.toHaveBeenCalled();
    });

    it('denies access tokens when no access-token verifier is configured', async () => {
      const verifyId = jest.fn(async () => ({ kind: 'user', email: 'a@example.com', sub: 's', name: null }));
      const svc = new CredentialService(null, { verify: verifyId } as unknown as JwtVerifier);
      expect(await svc.verify(jwtWith({ token_use: 'access' }))).toBeNull();
      expect(verifyId).not.toHaveBeenCalled();
    });

    it('denies psk_ keys when no key service is configured', async () => {
      const { svc } = makeDual();
      expect(await svc.verify('psk_live_abc')).toBeNull();
    });
  });

  it('returns null for empty / missing bearers without calling either verifier', async () => {
    const { svc, verifyKey, verifyJwt } = makeService();

    expect(await svc.verify('')).toBeNull();
    expect(await svc.verify(null)).toBeNull();
    expect(await svc.verify(undefined)).toBeNull();
    expect(await svc.verify('Bearer    ')).toBeNull();
    expect(verifyKey).not.toHaveBeenCalled();
    expect(verifyJwt).not.toHaveBeenCalled();
  });
});
