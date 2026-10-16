// The upstream system the example domain syncs from. UPSTREAM_URL names a JSON
// endpoint returning UpstreamItem[]; without it the worker uses the fixture
// below so a fresh deploy has data. Replace this module with your system's
// client (Salesforce, an ERP, a spreadsheet export) and keep fetchUpstream's
// contract: every record carries a stable externalId.
import type { UpstreamItem } from '@libs/items';

export const FIXTURE: UpstreamItem[] = [
  { externalId: 'EX-1001', name: 'Northwind Traders', category: 'Distributor', website: 'northwind.example', description: 'Regional distributor; quarterly review in March.', ownerEmail: 'owner.one@example.com' },
  { externalId: 'EX-1002', name: 'Contoso Logistics', category: 'Carrier', website: 'contoso.example', description: 'Primary freight carrier for the west region.', ownerEmail: 'owner.two@example.com' },
  { externalId: 'EX-1003', name: 'Fabrikam Components', category: 'Supplier', website: 'fabrikam.example', description: 'Supplies enclosures and fasteners; ISO 9001.', ownerEmail: 'owner.one@example.com' },
  { externalId: 'EX-1004', name: 'Tailspin Toys', category: 'Reseller', website: 'tailspin.example', description: 'Retail reseller; seasonal volume.', ownerEmail: null },
  { externalId: 'EX-1005', name: 'Litware Systems', category: 'Supplier', website: 'litware.example', description: 'Firmware and tooling vendor.', ownerEmail: 'owner.two@example.com', archived: true },
];

export async function fetchUpstream(fetchImpl: typeof fetch = fetch): Promise<UpstreamItem[]> {
  const url = process.env.UPSTREAM_URL?.trim();
  if (!url) return FIXTURE;
  const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`upstream ${url} returned ${res.status}`);
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) throw new Error('upstream payload is not an array');
  return body.filter((r): r is UpstreamItem => typeof r === 'object' && r !== null && typeof (r as UpstreamItem).externalId === 'string');
}
