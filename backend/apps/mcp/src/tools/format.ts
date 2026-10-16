// Small helpers shared across MCP tools so formatting and shape-reading stay consistent
// across every tool.
import type { ToolResult } from '../mcp/tools';

type Dict = Record<string, unknown>;

export const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);

// Compact USD for agent-readable output: $2.6M / $450K / $900.
export const money = (n: number): string =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${n}`;

export const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export const strArray = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v]).map((x) => str(x).trim()).filter(Boolean);
export const upperArray = (v: unknown): string[] => strArray(v).map((s) => s.toUpperCase());

export const nameOf = (v: unknown): string | null => {
  const o = v as Dict | null | undefined;
  return o && typeof o.name === 'string' && o.name ? o.name : null;
};

export const nameFromEmail = (email: string): string =>
  (email.split('@')[0] ?? '')
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

// Enum acronyms preserved as-is when humanizing (QBR needed by getActivities' text line).
const ENUM_ACRONYMS = new Set(['QBR', 'GSI', 'ISV', 'MSA', 'NDA', 'PE', 'GTM', 'SI', 'AI', 'CIO', 'CTO', 'NFR', 'POC']);
// Humanize an ALL_CAPS/underscored enum for display — sentence case, no underscores, acronyms
// preserved: CLOSED_WON -> "Closed won", MARKETING_WITH_CUSTOMER -> "Marketing with customer",
// INFLUENCED -> "Influenced", QBR -> "QBR". Empty string in -> empty string out.
export const humanizeEnum = (v: unknown): string =>
  str(v)
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w, i) => {
      const up = w.toUpperCase();
      if (ENUM_ACRONYMS.has(up)) return up;
      const lower = w.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');

// Resolver list results come back as { items: [...] }; normalize to a plain array.
export const items = (res: Dict): Dict[] => (Array.isArray(res.items) ? (res.items as Dict[]) : []);

export const textResult = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], isError });
