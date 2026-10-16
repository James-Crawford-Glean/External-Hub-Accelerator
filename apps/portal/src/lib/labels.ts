import type { ApiKeyScope, Role } from '../data/types';
import type { Tone } from '../components/ui/Badge';

export function roleLabel(role: Role | null | undefined): string {
  switch (role) {
    case 'ADMINISTRATOR':
      return 'Administrator';
    case 'EDITOR':
      return 'Editor';
    case 'VIEWER':
      return 'Viewer';
    default:
      return 'No role';
  }
}

export function statusTone(status: string): Tone {
  switch (status) {
    case 'ACTIVE':
    case 'success':
      return 'success';
    case 'DRAFT':
      return 'warning';
    case 'ARCHIVED':
    case 'REVOKED':
      return 'neutral';
    case 'REJECTED':
    case 'failed':
    case 'error':
      return 'danger';
    case 'running':
      return 'info';
    default:
      return 'neutral';
  }
}

export function humanize(value: string | null | undefined): string {
  if (!value) return '';
  return value.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export const apiKeyScopeLabels: Record<ApiKeyScope, string> = { READ: 'Read', WRITE: 'Write', ADMIN: 'Admin' };

/** What each scope grants; mirrors libs/authz on the server. */
export const apiKeyScopeDescriptions: Record<ApiKeyScope, string> = {
  READ: 'Read portal data the caller is allowed to see.',
  WRITE: 'Create and modify portal data.',
  ADMIN: 'Administrative operations: roles & access, settings, and API keys.',
};

export const apiKeyScopeTone: Record<ApiKeyScope, Tone> = { READ: 'outline', WRITE: 'info', ADMIN: 'brand' };

/** Short browser/OS label from a user agent; the raw string stays in the title. */
export function browserLabel(ua: string | null): string {
  if (!ua) return 'Unknown';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

