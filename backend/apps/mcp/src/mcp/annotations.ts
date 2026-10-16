// MCP ToolAnnotations (spec 2025-03-26). Hosts gate human-in-the-loop confirmation on
// readOnlyHint; without it every tool, reads included, gets an approval panel and the
// planner learns to avoid calling us. Lives apart from tools.ts so tool modules can
// import the constants without a value-import cycle.
export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const CREATES_RECORDS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

export const UPDATES_IN_PLACE: ToolAnnotations = { ...CREATES_RECORDS, idempotentHint: true };
