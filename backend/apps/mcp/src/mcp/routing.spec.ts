// Pins the tool-selection metadata a host reads: every advertised tool carries the
// live-data provenance note, read-only tools carry the supplementary-context note,
// and no tool is named like a generic search entry point (which would make the
// host route unrelated prompts here).
import { CATALOG_FILTERED_BY_CAPABILITY, listTools, LIVE_DATA_NOTE, SUPPLEMENTARY_CONTEXT_NOTE, toolByName } from './tools';

describe('MCP tool-selection metadata', () => {
  const advertised = Object.fromEntries(listTools().map((t) => [t.name, t]));

  it('advertises at least the platform tools', () => {
    expect(Object.keys(advertised)).toEqual(expect.arrayContaining(['whoAmI', 'listUsers']));
  });

  it('every tool states live provenance; read-only tools add the supplementary-context rule', () => {
    for (const t of Object.values(advertised)) {
      expect(t.description).toContain(LIVE_DATA_NOTE);
      if (t.annotations.readOnlyHint) expect(t.description).toContain(SUPPLEMENTARY_CONTEXT_NOTE);
      else expect(t.description).not.toContain(SUPPLEMENTARY_CONTEXT_NOTE);
    }
  });

  it('never exposes a generic search-shaped tool name', () => {
    expect(Object.keys(advertised)).not.toEqual(expect.arrayContaining(['search', 'query', 'ask']));
  });

  it('resolves host-mangled names back to the canonical tool', () => {
    expect(toolByName('portal__whoami')?.name).toBe('whoAmI');
    expect(toolByName(' WhoAmI ')?.name).toBe('whoAmI');
    expect(toolByName('nope')).toBeUndefined();
  });

  it('filters write tools out of the catalog for a caller who cannot write, and only then', () => {
    expect(CATALOG_FILTERED_BY_CAPABILITY).toBe(true);
    const names = (tools: ReturnType<typeof listTools>) => tools.map((t) => t.name).sort();
    expect(names(listTools({ canWrite: false }))).toEqual(['listUsers', 'searchItems', 'whoAmI']);
    expect(names(listTools({ canWrite: true }))).toEqual(['createItem', 'listUsers', 'searchItems', 'updateItem', 'whoAmI']);
    expect(names(listTools())).toEqual(names(listTools({ canWrite: true })));
    for (const t of listTools({ canWrite: false })) expect(t.annotations.readOnlyHint).toBe(true);
  });
});
