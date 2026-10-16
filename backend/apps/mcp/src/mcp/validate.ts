// One validation step for every tools/call: the arguments are checked against the
// tool's advertised inputSchema before the handler runs, so a handler can trust
// the shape it declared and the host gets one consistent -32602 for a bad call.
//
// Covers the JSON Schema subset the tools use: type, properties, required,
// additionalProperties: false, enum, items, minimum, maximum, minLength,
// maxLength. Scalars are coerced where the intent is unambiguous (a numeric
// string for integer / number, "true" / "false" for boolean, a lone scalar for
// an array) because hosts do send those; anything else is a violation.

export interface JsonSchema {
  readonly type?: 'object' | 'string' | 'integer' | 'number' | 'boolean' | 'array';
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly enum?: readonly unknown[];
  readonly items?: JsonSchema;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly description?: string;
}

export type Validation =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly violations: readonly string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function coerce(schema: JsonSchema, value: unknown): unknown {
  switch (schema.type) {
    case 'integer':
    case 'number':
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
      return value;
    case 'boolean':
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value;
    case 'array':
      return value === undefined || Array.isArray(value) ? value : [value];
    default:
      return value;
  }
}

function typeMatches(type: JsonSchema['type'], value: unknown): boolean {
  switch (type) {
    case 'object':
      return isRecord(value);
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    default:
      return true;
  }
}

const describe = (v: unknown): string => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

function check(schema: JsonSchema, raw: unknown, path: string, out: string[]): unknown {
  const value = coerce(schema, raw);
  if (schema.type && !typeMatches(schema.type, value)) {
    out.push(`${path}: expected ${schema.type}, got ${describe(value)}`);
    return value;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    out.push(`${path}: must be one of ${schema.enum.map(String).join(', ')}`);
    return value;
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) out.push(`${path}: must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) out.push(`${path}: must be <= ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) out.push(`${path}: must be at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) out.push(`${path}: must be at most ${schema.maxLength} characters`);
  }
  if (Array.isArray(value) && schema.items) {
    return value.map((item, i) => check(schema.items!, item, `${path}[${i}]`, out));
  }
  if (isRecord(value) && schema.type === 'object') {
    const props = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (value[key] === undefined) out.push(`${path ? `${path}.` : ''}${key}: required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) out.push(`${path ? `${path}.` : ''}${key}: not an accepted argument`);
      }
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, key in props && v !== undefined ? check(props[key]!, v, path ? `${path}.${key}` : key, out) : v]),
    );
  }
  return value;
}

/** Validate (and coerce) tools/call arguments against a tool's inputSchema. */
export function validateArguments(schema: JsonSchema, args: unknown): Validation {
  if (args !== undefined && !isRecord(args)) {
    return { ok: false, violations: [`arguments: expected object, got ${describe(args)}`] };
  }
  const violations: string[] = [];
  const value = check(schema, args ?? {}, '', violations) as Record<string, unknown>;
  return violations.length ? { ok: false, violations } : { ok: true, value };
}
