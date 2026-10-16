import { createHash } from 'node:crypto';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Logger } from '@libs/log';
import { AuroraService } from '@libs/aurora';
import { GleanService, MIN_PHOTO_BYTES } from '@libs/glean';

export const AVATARS_KEY_PREFIX = 'avatars';
const CACHE_CONTROL = 'public, max-age=2592000';

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};

function extFor(ct: string): string {
  return EXT[ct] || ct.split('/').pop()!.split('+')[0]! || 'img';
}

const sha = (buf: Uint8Array | string, n: number): string =>
  createHash('sha256')
    .update(typeof buf === 'string' ? Buffer.from(buf) : Buffer.from(buf))
    .digest('hex')
    .slice(0, n);

export interface GleanPerson {
  id: string;
  email: string | null;
  photoUrl: string | null;
  photoUrls?: string[];
}

export interface SyncForEmailOpts {
  /** Skip Glean/S3 work when a cached avatar was synced within this window. */
  skipIfSyncedWithinMs?: number;
}

/** Default freshness window for admin bulk sync (one week). */
export const AVATAR_BULK_FRESH_MS = 7 * 24 * 60 * 60 * 1000;

export class AvatarService {
  private readonly log = new Logger(AvatarService.name);
  private s3Client: S3Client | null = null;

  constructor(
    private readonly aurora: AuroraService,
    private readonly glean: GleanService,
  ) {}

  private s3(): S3Client {
    return (this.s3Client ??= new S3Client({}));
  }

  private bucket(): string {
    const b = process.env.LOGO_BUCKET_NAME;
    if (!b) throw new Error('LOGO_BUCKET_NAME is required');
    return b;
  }

  private cdnPrefix(): string {
    const p = process.env.LOGO_CDN_URL_PREFIX;
    if (!p) throw new Error('LOGO_CDN_URL_PREFIX is required');
    return p.replace(/\/+$/, '');
  }

  private s3Key(email: string, ct: string): string {
    return `${AVATARS_KEY_PREFIX}/usr_${sha(email.toLowerCase(), 16)}.${extFor(ct)}`;
  }

  async avatarUrlForEmail(email: string | null | undefined): Promise<string | null> {
    if (!email) return null;
    try {
      const rows = await this.aurora.query<{ avatar_url: string | null }>(
        'SELECT avatar_url FROM app.user_avatars WHERE email = :e LIMIT 1',
        { e: email.toLowerCase() },
      );
      return rows.length ? rows[0]!.avatar_url : null;
    } catch (e) {
      this.log.warn(`avatar.read_failed email=${email} err=${String(e)}`);
      return null;
    }
  }

  async avatarUrlsForEmails(emails: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    const uniq = [...new Set(emails.map((e) => e.toLowerCase()).filter(Boolean))];
    if (!uniq.length) return out;
    try {
      const placeholders = uniq.map((_, i) => `:e${i}`).join(', ');
      const params = Object.fromEntries(uniq.map((e, i) => [`e${i}`, e]));
      const rows = await this.aurora.query<{ email: string; avatar_url: string | null }>(
        `SELECT email, avatar_url FROM app.user_avatars WHERE email IN (${placeholders})`,
        params,
      );
      for (const e of uniq) out.set(e, null);
      for (const r of rows) out.set(r.email, r.avatar_url);
    } catch (e) {
      this.log.warn(`avatar.batch_read_failed err=${String(e)}`);
      for (const e of uniq) out.set(e, null);
    }
    return out;
  }

  async syncForOwner(ownerId: string, accessToken: string): Promise<string | null> {
    const rows = await this.aurora.query<{ email: string | null }>(
      'SELECT email FROM app.glean_tokens WHERE owner_user_id = :o LIMIT 1',
      { o: ownerId },
    );
    const email = rows[0]?.email;
    if (!email) {
      const user = await this.aurora.query<{ email: string | null }>(
        'SELECT email FROM app.users WHERE id = :id LIMIT 1',
        { id: ownerId },
      );
      if (!user.length || !user[0]!.email) return null;
      return (await this.syncForEmail(user[0]!.email, accessToken)).url;
    }
    return (await this.syncForEmail(email, accessToken)).url;
  }

  async syncForEmail(
    email: string,
    accessToken: string,
    person?: GleanPerson,
    opts: SyncForEmailOpts = {},
  ): Promise<{ url: string | null; skipped: boolean }> {
    const norm = email.toLowerCase().trim();
    if (!norm) return { url: null, skipped: false };

    if (opts.skipIfSyncedWithinMs != null && opts.skipIfSyncedWithinMs > 0) {
      const cached = await this.freshAvatar(norm, opts.skipIfSyncedWithinMs);
      if (cached) {
        this.log.log(`avatar.skip email=${norm} reason=fresh`);
        return { url: cached, skipped: true };
      }
    }

    const base = await this.glean.baseUrl();
    if (!base) return { url: null, skipped: false };
    const resolved = person ?? (await this.glean.findPersonByEmail(base, accessToken, norm));
    if (!resolved) {
      this.log.log(`avatar.miss email=${norm} reason=no_person`);
      return { url: null, skipped: false };
    }
    const bytes = await this.glean.fetchPersonPhotoBytes(base, accessToken, resolved);
    if (!bytes || bytes.body.length < MIN_PHOTO_BYTES) {
      this.log.log(
        `avatar.miss email=${norm} person=${resolved.id} reason=${bytes ? 'placeholder' : 'no_photo'}`,
      );
      await this.clearAvatar(norm);
      return { url: null, skipped: false };
    }
    const url = await this.put(this.s3Key(norm, bytes.contentType), bytes.body, bytes.contentType, norm);
    if (!url) return { url: null, skipped: false };
    await this.aurora.execute(
      'INSERT INTO app.user_avatars (email, avatar_url, glean_person_id, synced_at) ' +
        'VALUES (:e, :u, :p, now()) ' +
        'ON CONFLICT (email) DO UPDATE SET avatar_url = EXCLUDED.avatar_url, ' +
        'glean_person_id = EXCLUDED.glean_person_id, synced_at = now()',
      { e: norm, u: url, p: resolved.id },
    );
    return { url, skipped: false };
  }

  private async clearAvatar(email: string): Promise<void> {
    try {
      await this.aurora.execute('DELETE FROM app.user_avatars WHERE email = :e', { e: email });
    } catch (e) {
      this.log.warn(`avatar.clear_failed email=${email} err=${String(e)}`);
    }
  }

  private async freshAvatar(email: string, maxAgeMs: number): Promise<string | null> {
    try {
      const rows = await this.aurora.query<{ avatar_url: string | null; synced_at: string | Date }>(
        'SELECT avatar_url, synced_at FROM app.user_avatars WHERE email = :e LIMIT 1',
        { e: email },
      );
      const row = rows[0];
      if (!row?.avatar_url) return null;
      const syncedAt = row.synced_at instanceof Date ? row.synced_at : new Date(row.synced_at);
      if (Number.isNaN(syncedAt.getTime())) return null;
      if (Date.now() - syncedAt.getTime() > maxAgeMs) return null;
      // Tiny cached objects are Glean default silhouettes — force a re-fetch.
      // Head failures (missing IAM, etc.) must not clear rows; treat as unknown → skip.
      const plausible = await this.cachedObjectIsPlausible(row.avatar_url);
      if (plausible === false) return null;
      return row.avatar_url;
    } catch (e) {
      this.log.warn(`avatar.fresh_check_failed email=${email} err=${String(e)}`);
      return null;
    }
  }

  /** true = real photo, false = placeholder, null = could not determine. */
  private async cachedObjectIsPlausible(url: string): Promise<boolean | null> {
    try {
      const key = new URL(url).pathname.replace(/^\/+/, '');
      if (!key.startsWith(`${AVATARS_KEY_PREFIX}/`)) return true;
      const head = await this.s3().send(new HeadObjectCommand({ Bucket: this.bucket(), Key: key }));
      return (head.ContentLength ?? 0) >= MIN_PHOTO_BYTES;
    } catch (e) {
      this.log.warn(`avatar.head_failed url=${url.slice(0, 80)} err=${String(e)}`);
      return null;
    }
  }

  applyToUsers<T extends { email?: string; avatarUrl?: string | null }>(
    users: T[],
    avatars: Map<string, string | null>,
  ): T[] {
    for (const u of users) {
      const email = (u.email || '').toLowerCase();
      if (email) u.avatarUrl = avatars.get(email) ?? null;
    }
    return users;
  }

  collectEmailsFromUsers(users: Array<{ email?: string }>): string[] {
    return users.map((u) => u.email || '').filter(Boolean);
  }

  private async put(key: string, body: Uint8Array, ct: string, email: string): Promise<string | null> {
    try {
      await this.s3().send(
        new PutObjectCommand({
          Bucket: this.bucket(),
          Key: key,
          Body: body,
          ContentType: ct,
          CacheControl: CACHE_CONTROL,
        }),
      );
    } catch (e) {
      this.log.error(`avatar.s3_put_failed email=${email} key=${key} err=${String(e)}`);
      return null;
    }
    return `${this.cdnPrefix()}/${key}`;
  }
}
