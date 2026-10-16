import { AvatarService } from './avatar.service';
import type { AuroraService } from '@libs/aurora';
import type { GleanService } from '@libs/glean';

function fakeAurora(over: { query?: jest.Mock; execute?: jest.Mock } = {}): AuroraService {
  return {
    query: over.query ?? jest.fn(async () => []),
    execute: over.execute ?? jest.fn(async () => undefined),
  } as unknown as AuroraService;
}

function photoBytes(n = 4096): Uint8Array {
  return new Uint8Array(n).map((_, i) => i % 256);
}

function fakeGlean(over: Partial<Record<string, jest.Mock>> = {}): GleanService {
  return {
    baseUrl: over.baseUrl ?? jest.fn(async () => 'https://tenant.example.com'),
    findPersonByEmail:
      over.findPersonByEmail ??
      jest.fn(async () => ({
        id: 'p1',
        email: 'user@example.com',
        photoUrl: 'https://cdn.example/photo.jpg',
        photoUrls: ['https://cdn.example/photo.jpg'],
      })),
    fetchPersonPhotoBytes:
      over.fetchPersonPhotoBytes ??
      jest.fn(async () => ({ body: photoBytes(), contentType: 'image/png' })),
  } as unknown as GleanService;
}

function withS3(svc: AvatarService, send: jest.Mock = jest.fn(async () => ({ ContentLength: 4096 }))) {
  (svc as unknown as { s3Client: { send: jest.Mock } }).s3Client = { send };
  return send;
}

beforeEach(() => {
  process.env.LOGO_BUCKET_NAME = 'bucket';
  process.env.LOGO_CDN_URL_PREFIX = 'https://cdn.example';
});

describe('AvatarService.syncForEmail', () => {
  it('stores bytes in S3 and upserts app.user_avatars', async () => {
    const execute = jest.fn(async () => undefined);
    const svc = new AvatarService(fakeAurora({ execute }), fakeGlean());
    withS3(svc);
    const out = await svc.syncForEmail('user@example.com', 'token');
    expect(out.skipped).toBe(false);
    expect(out.url).toMatch(/https:\/\/cdn\.example\/avatars\/usr_[0-9a-f]{16}\.png$/);
    expect(execute).toHaveBeenCalled();
  });

  it('returns null when Glean has no person', async () => {
    const glean = fakeGlean({ findPersonByEmail: jest.fn(async () => null) });
    const svc = new AvatarService(fakeAurora(), glean);
    expect(await svc.syncForEmail('missing@example.com', 'token')).toEqual({ url: null, skipped: false });
  });

  it('rejects placeholder-sized photo bytes', async () => {
    const execute = jest.fn(async () => undefined);
    const glean = fakeGlean({
      fetchPersonPhotoBytes: jest.fn(async () => ({
        body: new Uint8Array(1020),
        contentType: 'image/png',
      })),
    });
    const svc = new AvatarService(fakeAurora({ execute }), glean);
    withS3(svc);
    expect(await svc.syncForEmail('user@example.com', 'token')).toEqual({ url: null, skipped: false });
    expect(execute).toHaveBeenCalledWith('DELETE FROM app.user_avatars WHERE email = :e', {
      e: 'user@example.com',
    });
  });

  it('skips fetch when a cached avatar is still fresh and plausible', async () => {
    const query = jest.fn(async () => [
      { avatar_url: 'https://cdn.example/avatars/usr_abc.png', synced_at: new Date() },
    ]);
    const findPersonByEmail = jest.fn();
    const fetchPersonPhotoBytes = jest.fn();
    const svc = new AvatarService(
      fakeAurora({ query }),
      fakeGlean({ findPersonByEmail, fetchPersonPhotoBytes }),
    );
    withS3(svc, jest.fn(async () => ({ ContentLength: 4096 })));
    const out = await svc.syncForEmail('user@example.com', 'token', undefined, {
      skipIfSyncedWithinMs: 7 * 24 * 60 * 60 * 1000,
    });
    expect(out).toEqual({ url: 'https://cdn.example/avatars/usr_abc.png', skipped: true });
    expect(findPersonByEmail).not.toHaveBeenCalled();
    expect(fetchPersonPhotoBytes).not.toHaveBeenCalled();
  });

  it('skips when HeadObject is denied rather than wiping the cache', async () => {
    const query = jest.fn(async () => [
      { avatar_url: 'https://cdn.example/avatars/usr_abc.png', synced_at: new Date() },
    ]);
    const findPersonByEmail = jest.fn();
    const fetchPersonPhotoBytes = jest.fn();
    const svc = new AvatarService(
      fakeAurora({ query }),
      fakeGlean({ findPersonByEmail, fetchPersonPhotoBytes }),
    );
    withS3(svc, jest.fn(async () => {
      throw Object.assign(new Error('AccessDenied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
    }));
    const out = await svc.syncForEmail('user@example.com', 'token', undefined, {
      skipIfSyncedWithinMs: 7 * 24 * 60 * 60 * 1000,
    });
    expect(out).toEqual({ url: 'https://cdn.example/avatars/usr_abc.png', skipped: true });
    expect(fetchPersonPhotoBytes).not.toHaveBeenCalled();
  });

  it('re-fetches when the cached object is a tiny placeholder', async () => {
    const query = jest.fn(async () => [
      { avatar_url: 'https://cdn.example/avatars/usr_tiny.png', synced_at: new Date() },
    ]);
    const execute = jest.fn(async () => undefined);
    const svc = new AvatarService(fakeAurora({ query, execute }), fakeGlean());
    withS3(svc, jest.fn(async () => ({ ContentLength: 1020 })));
    const out = await svc.syncForEmail('user@example.com', 'token', undefined, {
      skipIfSyncedWithinMs: 7 * 24 * 60 * 60 * 1000,
    });
    expect(out.skipped).toBe(false);
    expect(out.url).toMatch(/avatars\/usr_/);
    expect(execute).toHaveBeenCalled();
  });

  it('fetches when the cached avatar is stale', async () => {
    const weekAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const query = jest.fn(async () => [
      { avatar_url: 'https://cdn.example/avatars/usr_old.png', synced_at: weekAgo },
    ]);
    const execute = jest.fn(async () => undefined);
    const svc = new AvatarService(fakeAurora({ query, execute }), fakeGlean());
    withS3(svc);
    const out = await svc.syncForEmail('user@example.com', 'token', undefined, {
      skipIfSyncedWithinMs: 7 * 24 * 60 * 60 * 1000,
    });
    expect(out.skipped).toBe(false);
    expect(out.url).toMatch(/avatars\/usr_/);
    expect(execute).toHaveBeenCalled();
  });
});

describe('AvatarService.avatarUrlsForEmails', () => {
  it('batch-loads avatar URLs by email', async () => {
    const query = jest.fn(async () => [{ email: 'a@example.com', avatar_url: 'https://cdn.example/avatars/usr_a.png' }]);
    const svc = new AvatarService(fakeAurora({ query }), fakeGlean());
    const map = await svc.avatarUrlsForEmails(['a@example.com', 'b@example.com']);
    expect(map.get('a@example.com')).toBe('https://cdn.example/avatars/usr_a.png');
    expect(map.get('b@example.com')).toBeNull();
  });

  it('returns nulls when the table is not readable', async () => {
    const query = jest.fn(async () => {
      throw new Error('relation "app.user_avatars" does not exist');
    });
    const svc = new AvatarService(fakeAurora({ query }), fakeGlean());
    const map = await svc.avatarUrlsForEmails(['a@example.com']);
    expect(map.get('a@example.com')).toBeNull();
  });
});
