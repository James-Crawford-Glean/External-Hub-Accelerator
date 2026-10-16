import { REGISTRY } from './registry';
import { resolvers } from './container';

describe('registry', () => {
  it('points every field at a resolver class that exists in the container', () => {
    for (const [field, entry] of Object.entries(REGISTRY)) {
      expect(Object.keys(resolvers)).toContain(entry.key);
      expect(typeof field).toBe('string');
    }
  });
});
