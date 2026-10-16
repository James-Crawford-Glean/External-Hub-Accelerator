import { AuroraService } from '@libs/aurora';
import type { Identity } from '@libs/authz';
import { IdentityService } from '@libs/identity';

interface NoticeRow {
  id: string;
  title: string;
  body: string | null;
  href: string;
  created_at: string;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string | null;
  href: string;
  createdAt: string | null;
}

export class NotificationsResolver {
  constructor(
    private readonly aurora: AuroraService,
    private readonly identity: IdentityService,
  ) {}

  async notifications(args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<AppNotification[]> {
    const email = this.identity.callerEmail(identity);
    if (!email) return [];
    const requested = Number(args.limit);
    const limit = Math.min(50, Math.max(1, Number.isFinite(requested) && requested > 0 ? requested : 20));
    const rows = await this.aurora.query<NoticeRow>(
      'SELECT id, title, body, href, created_at FROM app.notifications ' +
        'WHERE recipient_email = :email AND read_at IS NULL ' +
        'ORDER BY created_at DESC LIMIT :lim',
      { email, lim: limit },
    );
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      body: r.body ? String(r.body) : null,
      href: String(r.href),
      createdAt: AuroraService.iso8601(r.created_at),
    }));
  }

  async markNotificationRead(args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<boolean> {
    const email = this.identity.callerEmail(identity);
    const id = typeof args.id === 'string' ? args.id : '';
    if (!email || !id) return false;
    await this.aurora.execute(
      'UPDATE app.notifications SET read_at = now() WHERE id = :id AND recipient_email = :email AND read_at IS NULL',
      { id, email },
    );
    return true;
  }
}
