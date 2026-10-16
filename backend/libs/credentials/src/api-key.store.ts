// DynamoDB I/O for the api_keys table. The document client is constructor-injected
// (tests pass a fake); the table prefix is read lazily (DDB_TABLE_PREFIX), never at
// module load. Items are snake_case; this layer is the only place that maps between
// the stored shape and the ApiKeyRecord domain type. The secret hash lives on the
// item + a hash-index GSI, and never leaves this file in a public record.
import { Logger } from '@libs/log';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ApiKeyRecord, ApiKeyStatus, Scope } from './types';

type Item = Record<string, unknown>;

const HASH_INDEX = 'hash-index';

export class ApiKeyStore {
  private readonly log = new Logger(ApiKeyStore.name);

  constructor(private readonly ddb: DynamoDBDocumentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))) {}

  private table(): string {
    const prefix = process.env.DDB_TABLE_PREFIX || 'portal-local';
    return `${prefix}-api_keys`;
  }

  /** Persist a new key. `secretHash` is stored on the item + hash-index; never elsewhere. */
  async put(record: ApiKeyRecord, secretHash: string): Promise<void> {
    await this.ddb.send(new PutCommand({ TableName: this.table(), Item: toItem(record, secretHash) }));
  }

  /** All keys, newest first. Scan is fine: admin-only surface, low cardinality. */
  async list(): Promise<ApiKeyRecord[]> {
    const resp = await this.ddb.send(new ScanCommand({ TableName: this.table() }));
    const records = (resp.Items ?? []).map((i) => fromItem(i as Item));
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<ApiKeyRecord | null> {
    const resp = await this.ddb.send(new GetCommand({ TableName: this.table(), Key: { id } }));
    return resp.Item ? fromItem(resp.Item as Item) : null;
  }

  /** Look up by peppered secret hash — finding a row *is* the verification. */
  async getByHash(secretHash: string): Promise<ApiKeyRecord | null> {
    const resp = await this.ddb.send(
      new QueryCommand({
        TableName: this.table(),
        IndexName: HASH_INDEX,
        KeyConditionExpression: 'secret_hash = :h',
        ExpressionAttributeValues: { ':h': secretHash },
        Limit: 1,
      }),
    );
    const item = resp.Items?.[0];
    return item ? fromItem(item as Item) : null;
  }

  /** Soft revoke: status → revoked, stamp revoked_at. Returns the updated record, or
   *  null if the id doesn't exist. */
  async revoke(id: string, revokedAt: string): Promise<ApiKeyRecord | null> {
    const resp = await this.ddb.send(
      new UpdateCommand({
        TableName: this.table(),
        Key: { id },
        ConditionExpression: 'attribute_exists(id)',
        UpdateExpression: 'SET #s = :revoked, revoked_at = :r',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':revoked': 'revoked', ':r': revokedAt },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return resp.Attributes ? fromItem(resp.Attributes as Item) : null;
  }

  async remove(id: string): Promise<void> {
    await this.ddb.send(new DeleteCommand({ TableName: this.table(), Key: { id } }));
  }

  /** Best-effort last-used stamp; callers fire-and-forget. */
  async touchLastUsed(id: string, at: string): Promise<void> {
    try {
      await this.ddb.send(
        new UpdateCommand({
          TableName: this.table(),
          Key: { id },
          UpdateExpression: 'SET last_used_at = :t',
          ExpressionAttributeValues: { ':t': at },
        }),
      );
    } catch (e) {
      this.log.error(`api_key.touch_error id=${id}`, e as Error);
    }
  }
}

function toItem(r: ApiKeyRecord, secretHash: string): Item {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    last4: r.last4,
    secret_hash: secretHash,
    scopes: r.scopes,
    status: r.status,
    created_at: r.createdAt,
    created_by: r.createdBy,
    last_used_at: r.lastUsedAt,
    expires_at: r.expiresAt,
    revoked_at: r.revokedAt,
  };
}

function fromItem(i: Item): ApiKeyRecord {
  return {
    id: String(i.id),
    name: String(i.name ?? ''),
    prefix: String(i.prefix ?? ''),
    last4: String(i.last4 ?? ''),
    scopes: (i.scopes as Scope[]) ?? [],
    status: (i.status as ApiKeyStatus) ?? 'active',
    createdAt: String(i.created_at ?? ''),
    createdBy: String(i.created_by ?? ''),
    lastUsedAt: (i.last_used_at as string | null) ?? null,
    expiresAt: (i.expires_at as string | null) ?? null,
    revokedAt: (i.revoked_at as string | null) ?? null,
  };
}
