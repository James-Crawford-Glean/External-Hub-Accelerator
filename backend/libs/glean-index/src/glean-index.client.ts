// Glean Indexing API client: the Hub -> Glean push path. Registers a custom
// datasource once, then indexes documents (one or in bulk) and deletes them.
// Documents carry a stable id, a title, a plain-text body, a view URL back into
// the portal, and permissions; Glean enforces those permissions at query time.
//
// The indexing token is read at runtime through a provider (Secrets Manager in
// production) and never logged, stored, or echoed in an error.
const ADD_DATASOURCE_PATH = '/api/index/v1/adddatasource';
const INDEX_DOCUMENT_PATH = '/api/index/v1/indexdocument';
const BULK_INDEX_PATH = '/api/index/v1/bulkindexdocuments';
const DELETE_DOCUMENT_PATH = '/api/index/v1/deletedocument';

export interface DatasourceSpec {
  /** Datasource name: lowercase letters, digits, underscores; stable forever. */
  name: string;
  displayName: string;
  /** Regex matching every viewURL this datasource emits, so Glean attributes clicks. */
  urlRegex: string;
  objectTypes: Array<{ name: string; docCategory?: string }>;
  datasourceCategory?: 'PUBLISHED_CONTENT' | 'KNOWLEDGE_HUB' | 'CRM' | 'TICKETS' | 'UNCATEGORIZED';
  /** Base URL of the portal, shown as the datasource home. */
  homeUrl?: string;
}

export type DocumentPermissions =
  | { allowAnonymousAccess: true }
  | { allowAllDatasourceUsersAccess: true }
  | { allowedUsers: Array<{ email: string }>; allowedGroups?: string[] };

export interface IndexDocument {
  id: string;
  objectType: string;
  title: string;
  body: string;
  viewUrl: string;
  permissions: DocumentPermissions;
  updatedAt?: Date;
  createdAt?: Date;
  owner?: { email: string };
  customProperties?: Array<{ name: string; value: string }>;
}

export interface GleanIndexConfig {
  /** Tenant backend origin, https://<tenant>-be.glean.com. */
  origin: string;
  datasource: string;
  token: () => Promise<string>;
  fetchImpl?: typeof fetch;
}

export class GleanIndexError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GleanIndexError';
  }
}

export class GleanIndexClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: GleanIndexConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  /** Idempotent on Glean's side: re-registering the same name updates its definition. */
  async addDatasource(spec: DatasourceSpec): Promise<void> {
    await this.post(ADD_DATASOURCE_PATH, {
      name: spec.name,
      displayName: spec.displayName,
      datasourceCategory: spec.datasourceCategory ?? 'KNOWLEDGE_HUB',
      urlRegex: spec.urlRegex,
      homeUrl: spec.homeUrl,
      objectDefinitions: spec.objectTypes.map((o) => ({ name: o.name, docCategory: o.docCategory ?? 'KNOWLEDGE_HUB' })),
      isUserReferencedByEmail: true,
    });
  }

  async indexDocument(doc: IndexDocument): Promise<void> {
    await this.post(INDEX_DOCUMENT_PATH, { document: this.toWire(doc) });
  }

  /** Full replace of the datasource's contents in one upload (pages of 100). */
  async bulkIndexDocuments(docs: IndexDocument[], uploadId = `upl_${Date.now()}`): Promise<number> {
    const pages = chunk(docs, 100);
    if (pages.length === 0) pages.push([]);
    for (const [i, page] of pages.entries()) {
      await this.post(BULK_INDEX_PATH, {
        uploadId,
        datasource: this.cfg.datasource,
        documents: page.map((d) => this.toWire(d)),
        isFirstPage: i === 0,
        isLastPage: i === pages.length - 1,
        forceRestartUpload: i === 0,
      });
    }
    return docs.length;
  }

  /** A document that is already gone is not an error. */
  async deleteDocument(objectType: string, id: string): Promise<void> {
    await this.post(DELETE_DOCUMENT_PATH, { datasource: this.cfg.datasource, objectType, id }, [404]);
  }

  private toWire(doc: IndexDocument): Record<string, unknown> {
    return {
      datasource: this.cfg.datasource,
      objectType: doc.objectType,
      id: doc.id,
      title: doc.title,
      viewURL: doc.viewUrl,
      body: { mimeType: 'text/plain', textContent: doc.body },
      permissions: doc.permissions,
      ...(doc.owner ? { owner: doc.owner } : {}),
      ...(doc.updatedAt ? { updatedAt: Math.floor(doc.updatedAt.getTime() / 1000) } : {}),
      ...(doc.createdAt ? { createdAt: Math.floor(doc.createdAt.getTime() / 1000) } : {}),
      ...(doc.customProperties?.length ? { customProperties: doc.customProperties } : {}),
    };
  }

  private async post(path: string, body: unknown, okStatuses: number[] = []): Promise<void> {
    const bearer = (await this.cfg.token()).trim();
    if (!bearer) throw new GleanIndexError('Glean indexing token is empty', 0);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.cfg.origin}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new GleanIndexError('Glean could not be reached', 0);
    }
    if (response.ok || okStatuses.includes(response.status)) return;
    const detail = (await response.text().catch(() => '')).split(bearer).join('[redacted]').trim().slice(0, 400);
    throw new GleanIndexError(`Glean ${path} failed (${response.status})${detail ? `: ${detail}` : ''}`, response.status);
  }
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
