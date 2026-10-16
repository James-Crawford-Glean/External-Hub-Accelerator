// The schema is the API definition AND the resolver wiring (the appsync module
// parses it into one pipeline resolver per field). Pin the two against each
// other so a field added on one side without the other fails here, not in
// production as a null.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REGISTRY } from './registry';

function fields(schema: string, typeName: string): string[] {
  const m = new RegExp(`type\\s+${typeName}\\b[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(schema);
  if (!m) return [];
  return m[1]!
    .split('\n')
    .map((l) => l.replace(/"[^"]*"/g, '').split('#', 1)[0]!.trim())
    .filter((l) => l && !l.startsWith('"'))
    .map((l) => /^(\w+)\s*(?:\(|:)/.exec(l)?.[1])
    .filter((n): n is string => Boolean(n));
}

describe('schema.graphql <-> registry', () => {
  const schema = readFileSync(join(__dirname, '../../../schema.graphql'), 'utf8');
  const schemaFields = [...fields(schema, 'Query'), ...fields(schema, 'Mutation')];
  const registered = Object.keys(REGISTRY).filter((k) => !k.startsWith('op:'));

  it('every schema field has a resolver', () => {
    expect(schemaFields.toSorted()).toEqual(expect.arrayContaining(registered.toSorted()));
    const missing = schemaFields.filter((f) => !registered.includes(f));
    expect(missing).toEqual([]);
  });

  it('every registered field is in the schema', () => {
    const orphans = registered.filter((f) => !schemaFields.includes(f));
    expect(orphans).toEqual([]);
  });
});
