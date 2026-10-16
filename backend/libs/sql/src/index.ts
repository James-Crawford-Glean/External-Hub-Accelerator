// SQL-builder helpers for the RDS Data API resolvers. Column names are always
// code constants; values are always bound params (no interpolation of user input).

/** `regexp_replace(lower(col), '^www\\.', '')`: a hostname without its www. */
export const bareDomainSql = (col: string): string => `regexp_replace(lower(${col}), '^www\\.', '')`;

/** Lowercased alphanumerics only, for name matching that ignores punctuation and case. */
export const squashNameSql = (col: string): string => `regexp_replace(lower(${col}), '[^a-z0-9]', '', 'g')`;

export type Params = Record<string, string | number | boolean | null>;

/** `:prefix_0, :prefix_1, …` — placeholder list, binding each value into params. */
export function placeholders(vals: unknown[], params: Params, prefix: string): string {
  return vals
    .map((v, i) => {
      const key = `${prefix}_${i}`;
      params[key] = v as Params[string];
      return `:${key}`;
    })
    .join(', ');
}

/** `col IN (:prefix_0, …)`, binding each value into params. */
export function inClause(col: string, vals: unknown[], params: Params, prefix: string): string {
  return `${col} IN (${placeholders(vals, params, prefix)})`;
}

/** Bind clamped :lim / :off from args.limit / args.offset into params. */
export function paginate(
  args: { limit?: number | null; offset?: number | null },
  params: Params,
  { def = 100, maxLimit = 1000 }: { def?: number; maxLimit?: number } = {},
): void {
  params.lim = Math.max(1, Math.min(Number(args.limit ?? def), maxLimit));
  params.off = Math.max(0, Number(args.offset ?? 0));
}

/** Bind each provided (non-null) input field; return [col, placeholder] pairs.
 *  mapping = {graphqlField: column}; casts adds `::type` to a column's placeholder. */
export function bind(
  input: Record<string, unknown>,
  mapping: Record<string, string>,
  params: Params,
  casts: Record<string, string> = {},
): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const [key, col] of Object.entries(mapping)) {
    if (input[key] != null) {
      params[col] = input[key] as Params[string];
      pairs.push([col, col in casts ? `:${col}::${casts[col]}` : `:${col}`]);
    }
  }
  return pairs;
}

/** `col = placeholder` SET fragments for each provided input field. */
export function assignments(
  input: Record<string, unknown>,
  mapping: Record<string, string>,
  params: Params,
  casts: Record<string, string> = {},
): string[] {
  return bind(input, mapping, params, casts).map(([col, ph]) => `${col} = ${ph}`);
}
