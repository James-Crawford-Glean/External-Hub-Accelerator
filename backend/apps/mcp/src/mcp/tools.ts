// MCP tool registry. Each tool is a self-describing unit: a JSON Schema for its
// input plus a handler. Tools register in ALL; the server dispatches tools/call
// by name. Add a domain tool by writing apps/mcp/src/tools/<name>.ts and
// listing it here.
import type { Identity } from '@libs/authz';
import type { ToolAnnotations } from './annotations';
import type { JsonSchema } from './validate';
import { whoAmI } from '../tools/whoAmI';
import { listUsers } from '../tools/listUsers';
import { searchItems } from '../tools/searchItems';
import { createItem } from '../tools/createItem';
import { updateItem } from '../tools/updateItem';

/** MCP tool-call result: structured content plus a short human-readable summary. */
export interface ToolResult {
  readonly content: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>;
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
  readonly _meta?: { readonly portal: ToolResponseMetadata };
}

/**
 * Provenance envelope attached to every tools/call response under `_meta`, so
 * an agent can tell a real empty result from a failure instead of narrating
 * one as the other. Additive: `content` and `structuredContent` keep their
 * shapes.
 */
export interface ToolResponseMetadata {
  readonly source: string;
  readonly retrievedAt: string;
  readonly status: 'success' | 'no_matches' | 'partial' | 'authorization_error' | 'validation_error' | 'server_failure';
  readonly matches?: number;
  readonly unmatched?: number;
  readonly coverage?: { readonly complete: boolean; readonly returned?: number; readonly total?: number };
  readonly dataAsOf?: string;
  readonly summary: string;
}

/** Per-call context threaded from the request: the resolved principal. */
export interface ToolContext {
  readonly identity: Identity;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  /** Advertised by tools/list and enforced by the server before `handler` runs. */
  readonly inputSchema: JsonSchema;
  readonly annotations: ToolAnnotations;
  readonly handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

/** Public descriptor sent over the wire by `tools/list` (never leaks the handler). */
export type ToolDescriptor = Pick<ToolDefinition, 'name' | 'description' | 'inputSchema' | 'annotations'>;

/** Display name of this portal in tool descriptions and provenance metadata. */
export const PORTAL_NAME = process.env.PORTAL_NAME || 'Portal';

// Appended to every advertised description. A retrieval-first assistant will
// answer from an indexed export of the same data unless the tool asserts
// precedence for record-level facts.
export const LIVE_DATA_NOTE =
  `Source: live ${PORTAL_NAME} records. Use this action for the record-level task described above, however the ` +
  `prompt is phrased; never substitute search results, indexed documents, prior chats, or memory for a ` +
  `${PORTAL_NAME}-owned fact. Do not use it for general policy, documentation lookup, or generic company knowledge.`;
export const SUPPLEMENTARY_CONTEXT_NOTE =
  'Label any search additions "Supplementary context"; tool figures win on conflict.';

const advertisedDescription = ({ description, annotations }: ToolDefinition): string =>
  [description, LIVE_DATA_NOTE, annotations.readOnlyHint ? SUPPLEMENTARY_CONTEXT_NOTE : ''].filter(Boolean).join(' ');

// Platform tools, then the example domain's. Replace the latter with yours.
const ALL: ToolDefinition[] = [whoAmI, listUsers, searchItems, createItem, updateItem];

export const TOOLS: Readonly<Record<string, ToolDefinition>> = Object.fromEntries(ALL.map((t) => [t.name, t]));
const TOOLS_BY_LOWER: Readonly<Record<string, ToolDefinition>> = Object.fromEntries(
  ALL.map((t) => [t.name.toLowerCase(), t]),
);

// Some hosts store `<server>__<lowercased tool name>` and may call title-case or
// lowercase; tools/list still advertises the canonical camelCase name.
export const toolByName = (name: string): ToolDefinition | undefined => {
  const trimmed = name.trim();
  const bare = trimmed.includes('__') ? trimmed.slice(trimmed.lastIndexOf('__') + 2) : trimmed;
  return TOOLS[trimmed] ?? TOOLS[bare] ?? TOOLS_BY_LOWER[trimmed.toLowerCase()] ?? TOOLS_BY_LOWER[bare.toLowerCase()];
};

export function listTools(): ToolDescriptor[] {
  return ALL.map((t) => ({
    name: t.name,
    description: advertisedDescription(t),
    inputSchema: t.inputSchema,
    annotations: t.annotations,
  }));
}
