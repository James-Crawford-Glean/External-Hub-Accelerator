// The argument gate: every tools/call is checked against the tool's inputSchema
// before the handler runs. Pure cases on the validator, then the server path
// with a spy handler to prove an out-of-schema call never reaches it.
import { handleRpc } from './server';
import { TOOLS, type ToolDefinition } from './tools';
import { HOST_INJECTED_ARGUMENTS, validateArguments, type JsonSchema } from './validate';

const schema: JsonSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    status: { type: 'array', items: { type: 'string', enum: ['ACTIVE', 'ARCHIVED'] } },
    kind: { type: 'string', enum: ['A', 'B'] },
    dryRun: { type: 'boolean' },
    note: { type: 'string', minLength: 1, maxLength: 5 },
  },
  additionalProperties: false,
};

describe('validateArguments', () => {
  it('accepts a conforming call and returns it unchanged', () => {
    const v = validateArguments(schema, { id: 'x', limit: 10, status: ['ACTIVE'], kind: 'A', dryRun: true });
    expect(v).toEqual({ ok: true, value: { id: 'x', limit: 10, status: ['ACTIVE'], kind: 'A', dryRun: true } });
  });

  it('treats missing arguments as an empty object and reports required keys', () => {
    expect(validateArguments(schema, undefined)).toEqual({ ok: false, violations: ['id: required'] });
    expect(validateArguments({ type: 'object', properties: {}, additionalProperties: false }, undefined)).toEqual({ ok: true, value: {} });
  });

  it('rejects keys the schema does not declare', () => {
    const v = validateArguments(schema, { id: 'x', bogus: 1 });
    expect(v).toEqual({ ok: false, violations: ['bogus: not an accepted argument'] });
  });

  it('drops host-injected arguments before the closed-schema check, and only those', () => {
    expect([...HOST_INJECTED_ARGUMENTS]).toEqual(['_user_goal']);
    expect(validateArguments(schema, { id: 'x', _user_goal: 'archive northwind' })).toEqual({ ok: true, value: { id: 'x' } });
    expect(validateArguments(schema, { id: 'x', _user_goal: 'archive northwind', bogus: 1 })).toEqual({
      ok: false,
      violations: ['bogus: not an accepted argument'],
    });
  });

  it('passes a host-injected argument through when the tool declares it', () => {
    const declaring: JsonSchema = { ...schema, properties: { ...schema.properties, _user_goal: { type: 'string' } } };
    expect(validateArguments(declaring, { id: 'x', _user_goal: 'archive northwind' })).toEqual({
      ok: true,
      value: { id: 'x', _user_goal: 'archive northwind' },
    });
  });

  it('rejects a wrong type, an out-of-range number, an enum miss, and a bad array element, naming each path', () => {
    const v = validateArguments(schema, { id: 7, limit: 500, kind: 'Z', status: ['ACTIVE', 'DRAFT'], note: '' });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.violations).toEqual([
      'id: expected string, got number',
      'limit: must be <= 100',
      'kind: must be one of A, B',
      'status[1]: must be one of ACTIVE, ARCHIVED',
      'note: must be at least 1 characters',
    ]);
  });

  it('coerces what hosts commonly send: numeric strings, boolean strings, a lone scalar for an array', () => {
    const v = validateArguments(schema, { id: 'x', limit: '25', dryRun: 'false', status: 'ARCHIVED' });
    expect(v).toEqual({ ok: true, value: { id: 'x', limit: 25, dryRun: false, status: ['ARCHIVED'] } });
  });

  it('does not coerce what is ambiguous', () => {
    const v = validateArguments(schema, { id: 'x', limit: 'ten', dryRun: 'yes' });
    expect(v).toEqual({
      ok: false,
      violations: ['limit: expected integer, got string', 'dryRun: expected boolean, got string'],
    });
    expect(validateArguments(schema, { id: 'x', limit: 2.5 })).toEqual({ ok: false, violations: ['limit: expected integer, got number'] });
  });

  it('rejects non-object arguments outright', () => {
    expect(validateArguments(schema, ['x'])).toEqual({ ok: false, violations: ['arguments: expected object, got array'] });
    expect(validateArguments(schema, 'x')).toEqual({ ok: false, violations: ['arguments: expected object, got string'] });
  });
});

describe('tools/call argument gate', () => {
  const identity = { kind: 'user', email: 'ops@example.com', sub: 'sub-ops' };
  const call = (name: string, args: unknown) =>
    handleRpc({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args as Record<string, unknown> } }, { identity });

  it('an out-of-schema argument is a -32602 error and the handler never runs', async () => {
    const tool = TOOLS.listUsers as ToolDefinition;
    const handler = jest.spyOn(tool, 'handler');
    try {
      const res = await call('listUsers', { search: 'ola', limit: 0, bogus: true });
      expect(handler).not.toHaveBeenCalled();
      expect(res?.result).toBeUndefined();
      // Object-level violations (required, unknown keys) come first, then per-property ones in argument order.
      expect(res?.error).toMatchObject({
        code: -32602,
        message: 'invalid arguments for listUsers: bogus: not an accepted argument; limit: must be >= 1',
        data: { status: 'validation_error', violations: ['bogus: not an accepted argument', 'limit: must be >= 1'] },
      });
    } finally {
      handler.mockRestore();
    }
  });

  it('a conforming call reaches the handler with the coerced arguments', async () => {
    const tool = TOOLS.listUsers as ToolDefinition;
    const handler = jest.spyOn(tool, 'handler').mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], structuredContent: { total: 0, rows: [] } });
    try {
      const res = await call('listUsers', { search: 'ola', limit: '5' });
      expect(handler).toHaveBeenCalledWith({ search: 'ola', limit: 5 }, { identity });
      expect(res?.error).toBeUndefined();
    } finally {
      handler.mockRestore();
    }
  });

  it('a Glean-injected _user_goal on a write passes the gate and never reaches the handler', async () => {
    const tool = TOOLS.updateItem as ToolDefinition;
    const handler = jest.spyOn(tool, 'handler').mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], structuredContent: { record: {} } });
    try {
      const res = await call('updateItem', { id: 'itm_1', status: 'ARCHIVED', _user_goal: 'archive Northwind' });
      expect(handler).toHaveBeenCalledWith({ id: 'itm_1', status: 'ARCHIVED' }, { identity });
      expect(res?.error).toBeUndefined();
    } finally {
      handler.mockRestore();
    }
  });

  it('an unknown extra argument alongside _user_goal is still a -32602', async () => {
    const tool = TOOLS.createItem as ToolDefinition;
    const handler = jest.spyOn(tool, 'handler');
    try {
      const res = await call('createItem', { name: 'Fabrikam', _user_goal: 'add Fabrikam', bogus: true });
      expect(handler).not.toHaveBeenCalled();
      expect(res?.error).toMatchObject({ code: -32602, data: { violations: ['bogus: not an accepted argument'] } });
    } finally {
      handler.mockRestore();
    }
  });

  it('every registered tool advertises a closed object schema, so the gate has something to enforce', () => {
    for (const tool of Object.values(TOOLS)) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });
});
