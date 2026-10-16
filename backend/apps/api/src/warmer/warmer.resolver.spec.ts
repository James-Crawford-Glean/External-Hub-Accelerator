import { WarmerResolver } from './warmer.resolver';
import type { AuroraService } from '@libs/aurora';
import type { AuthzService } from '@libs/authz';

const authz = { requireAdmin: jest.fn(async () => undefined) } as unknown as AuthzService;

function makeAurora(row: Record<string, any>) {
  return {
    query: jest.fn(async () => [row]),
    execute: jest.fn(async () => undefined),
  } as unknown as AuroraService & { query: jest.Mock; execute: jest.Mock };
}

describe('WarmerResolver', () => {
  it('warmerConfig requires admin + returns shaped config', async () => {
    const aurora = makeAurora({ enabled: true, concurrency: 2, updated_at: '2026-07-07 12:00:00+00', updated_by: 'a@example.com' });
    const r = new WarmerResolver(aurora, authz);
    const out = await r.warmerConfig({}, null, { email: 'a@example.com' });
    expect(authz.requireAdmin).toHaveBeenCalled();
    expect(out).toMatchObject({ enabled: true, concurrency: 2, updatedBy: 'a@example.com' });
    expect(out.updatedAt).toBe('2026-07-07T12:00:00.000Z');
  });

  it('setWarmerConfig clamps concurrency + only updates provided knobs (COALESCE)', async () => {
    const aurora = makeAurora({ enabled: false, concurrency: 20, updated_at: null, updated_by: 'a@example.com' });
    const r = new WarmerResolver(aurora, authz);
    await r.setWarmerConfig({ enabled: false, concurrency: 999 }, null, { email: 'a@example.com' });
    const [, params] = aurora.execute.mock.calls[0];
    expect(params.enabled).toBe(false);
    expect(params.concurrency).toBe(20); // clamped from 999
    expect(params.by).toBe('a@example.com');
  });

  it('setWarmerConfig passes null for omitted knobs (keep current)', async () => {
    const aurora = makeAurora({ enabled: true, concurrency: 2, updated_at: null, updated_by: null });
    const r = new WarmerResolver(aurora, authz);
    await r.setWarmerConfig({ enabled: true }, null, { sub: 'sub-1' });
    const [, params] = aurora.execute.mock.calls[0];
    expect(params.concurrency).toBeNull();
    expect(params.by).toBe('sub-1');
  });
});
