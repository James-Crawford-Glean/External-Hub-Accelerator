import { GleanIndexClient, GleanIndexError, type IndexDocument } from './glean-index.client';

function fakeFetch(status = 200, body = '') {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const client = (f: typeof fetch) =>
  new GleanIndexClient({ origin: 'https://tenant-be.example.net', datasource: 'portal_items', token: async () => 'tok-secret', fetchImpl: f });

const doc: IndexDocument = {
  id: 'itm_1',
  objectType: 'Item',
  title: 'Widget',
  body: 'A widget.',
  viewUrl: 'https://example.portal.example.com/portal/items/itm_1',
  permissions: { allowAllDatasourceUsersAccess: true },
  updatedAt: new Date('2026-01-02T03:04:05Z'),
};

describe('GleanIndexClient', () => {
  it('indexes one document with the wire shape Glean expects', async () => {
    const { impl, calls } = fakeFetch();
    await client(impl).indexDocument(doc);
    expect(calls[0]!.url).toBe('https://tenant-be.example.net/api/index/v1/indexdocument');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok-secret');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      document: {
        datasource: 'portal_items',
        objectType: 'Item',
        id: 'itm_1',
        title: 'Widget',
        viewURL: 'https://example.portal.example.com/portal/items/itm_1',
        body: { mimeType: 'text/plain', textContent: 'A widget.' },
        permissions: { allowAllDatasourceUsersAccess: true },
        updatedAt: 1767323045,
      },
    });
  });

  it('bulk-indexes in pages with first/last markers', async () => {
    const { impl, calls } = fakeFetch();
    const docs = Array.from({ length: 150 }, (_, i) => ({ ...doc, id: `itm_${i}` }));
    await expect(client(impl).bulkIndexDocuments(docs, 'upl_test')).resolves.toBe(150);
    expect(calls).toHaveLength(2);
    const first = JSON.parse(calls[0]!.init.body as string);
    const last = JSON.parse(calls[1]!.init.body as string);
    expect(first).toMatchObject({ uploadId: 'upl_test', isFirstPage: true, isLastPage: false, forceRestartUpload: true });
    expect(first.documents).toHaveLength(100);
    expect(last).toMatchObject({ isFirstPage: false, isLastPage: true, forceRestartUpload: false });
    expect(last.documents).toHaveLength(50);
  });

  it('an empty bulk upload still sends one terminal page (clears the datasource)', async () => {
    const { impl, calls } = fakeFetch();
    await client(impl).bulkIndexDocuments([], 'upl_empty');
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ documents: [], isFirstPage: true, isLastPage: true });
  });

  it('treats a 404 on delete as already gone', async () => {
    const { impl } = fakeFetch(404);
    await expect(client(impl).deleteDocument('Item', 'itm_x')).resolves.toBeUndefined();
  });

  it('surfaces failures with the token redacted', async () => {
    const { impl } = fakeFetch(403, 'forbidden for tok-secret');
    await expect(client(impl).indexDocument(doc)).rejects.toMatchObject({
      name: 'GleanIndexError',
      status: 403,
      message: expect.stringContaining('[redacted]'),
    } satisfies Partial<GleanIndexError>);
  });

  it('refuses to call Glean with an empty token', async () => {
    const { impl, calls } = fakeFetch();
    const c = new GleanIndexClient({ origin: 'https://x.example', datasource: 'd', token: async () => '  ', fetchImpl: impl });
    await expect(c.indexDocument(doc)).rejects.toThrow('token is empty');
    expect(calls).toHaveLength(0);
  });
});
