import {
  RDSDataClient,
  ExecuteStatementCommand,
  BatchExecuteStatementCommand,
  BeginTransactionCommand,
} from '@aws-sdk/client-rds-data';
import { AuroraService, type AuroraConfig } from './aurora.service';

const CFG: AuroraConfig = { resourceArn: 'arn:cluster', secretArn: 'arn:secret', database: 'portal' };

function fakeClient(sendImpl: (cmd: any) => any) {
  const send = jest.fn(async (cmd: any) => sendImpl(cmd));
  return { client: { send } as unknown as RDSDataClient, send };
}

describe('AuroraService.iso8601', () => {
  it('treats a naive Data-API timestamp as UTC', () => {
    expect(AuroraService.iso8601('2026-06-16 19:20:38.144')).toBe('2026-06-16T19:20:38.144Z');
  });
  it('honors a bare +00 offset', () => {
    expect(AuroraService.iso8601('2026-06-16 19:20:38+00')).toBe('2026-06-16T19:20:38.000Z');
  });
  it('returns null for empty/nullish input', () => {
    expect(AuroraService.iso8601(null)).toBeNull();
    expect(AuroraService.iso8601('')).toBeNull();
  });
});

describe('AuroraService.query', () => {
  it('parses formattedRecords JSON into row objects', async () => {
    const { client, send } = fakeClient(() => ({ formattedRecords: JSON.stringify([{ id: '1', name: 'Acme' }]) }));
    const svc = new AuroraService(client, CFG);
    const rows = await svc.query('SELECT 1');
    expect(rows).toEqual([{ id: '1', name: 'Acme' }]);
    expect(send.mock.calls[0][0]).toBeInstanceOf(ExecuteStatementCommand);
    expect(send.mock.calls[0][0].input.formatRecordsAs).toBe('JSON');
  });
  it('returns [] when no records are returned', async () => {
    const { client } = fakeClient(() => ({}));
    const svc = new AuroraService(client, CFG);
    expect(await svc.query('SELECT 1')).toEqual([]);
  });

  it('translates the Data API 1MB result cap into a typed, actionable DatasetTooLargeError', async () => {
    const sdkError = Object.assign(new Error('The result exceeds the size limit 1 MB.'), {
      name: 'UnsupportedResultException',
    });
    const { client } = fakeClient(() => {
      throw sdkError;
    });
    const svc = new AuroraService(client, CFG);
    await expect(svc.query('SELECT * FROM sync.accounts WHERE id IN (:a_0, :a_1)', { a_0: 'x', a_1: 'y' })).rejects.toMatchObject(
      {
        name: 'DatasetTooLargeError',
        context: { paramCount: 2 },
      },
    );
  });

  it('does not retry or reshape an unrelated Data API error', async () => {
    const other = Object.assign(new Error('column "nope" does not exist'), { name: 'DatabaseErrorException' });
    const { client } = fakeClient(() => {
      throw other;
    });
    const svc = new AuroraService(client, CFG);
    await expect(svc.query('SELECT nope FROM sync.accounts')).rejects.toBe(other);
  });
});

describe('AuroraService param typing', () => {
  it('maps JS types to Data-API typed params', async () => {
    const { client, send } = fakeClient(() => ({}));
    const svc = new AuroraService(client, CFG);
    await svc.execute('INSERT', { i: 3, f: 1.5, s: 'x', b: true, n: null });
    const params = send.mock.calls[0][0].input.parameters;
    const by = Object.fromEntries(params.map((p: any) => [p.name, p.value]));
    expect(by.i).toEqual({ longValue: 3 });
    expect(by.f).toEqual({ doubleValue: 1.5 });
    expect(by.s).toEqual({ stringValue: 'x' });
    expect(by.b).toEqual({ booleanValue: true });
    expect(by.n).toEqual({ isNull: true });
  });
});

describe('AuroraService.transaction', () => {
  it('commits on clean return', async () => {
    const { client, send } = fakeClient((cmd) => (cmd instanceof BeginTransactionCommand ? { transactionId: 'tx1' } : {}));
    const svc = new AuroraService(client, CFG);
    const out = await svc.transaction(async (tx) => {
      await svc.execute('UPDATE', { a: 1 }, { tx });
      return 'ok';
    });
    expect(out).toBe('ok');
    const kinds = send.mock.calls.map((c) => c[0].constructor.name);
    expect(kinds).toEqual(['BeginTransactionCommand', 'ExecuteStatementCommand', 'CommitTransactionCommand']);
    expect(send.mock.calls[1][0].input.transactionId).toBe('tx1');
  });
  it('rolls back and rethrows on failure', async () => {
    const { client, send } = fakeClient((cmd) => (cmd instanceof BeginTransactionCommand ? { transactionId: 'tx1' } : {}));
    const svc = new AuroraService(client, CFG);
    await expect(
      svc.transaction(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const kinds = send.mock.calls.map((c) => c[0].constructor.name);
    expect(kinds).toContain('RollbackTransactionCommand');
    expect(kinds).not.toContain('CommitTransactionCommand');
  });
});

describe('AuroraService.batch', () => {
  it('chunks parameter sets and returns the submitted count', async () => {
    const { client, send } = fakeClient(() => ({}));
    const svc = new AuroraService(client, CFG);
    const sets = Array.from({ length: 250 }, (_, i) => ({ id: String(i) }));
    const n = await svc.batch('UPSERT', sets, 100);
    expect(n).toBe(250);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0][0]).toBeInstanceOf(BatchExecuteStatementCommand);
    expect(send.mock.calls[0][0].input.parameterSets).toHaveLength(100);
    expect(send.mock.calls[2][0].input.parameterSets).toHaveLength(50);
  });
});

describe('AuroraService retry', () => {
  it('retries on DatabaseResuming then succeeds', async () => {
    jest.useFakeTimers();
    let calls = 0;
    const { client } = fakeClient(() => {
      if (++calls === 1) {
        const e: any = new Error('resuming');
        e.name = 'DatabaseResumingException';
        throw e;
      }
      return { formattedRecords: '[]' };
    });
    const svc = new AuroraService(client, CFG);
    const p = svc.query('SELECT 1');
    await jest.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toEqual([]);
    expect(calls).toBe(2);
    jest.useRealTimers();
  });

  it('propagates non-retryable errors immediately', async () => {
    const { client, send } = fakeClient(() => {
      const e: any = new Error('bad sql');
      e.name = 'BadRequestException';
      throw e;
    });
    const svc = new AuroraService(client, CFG);
    await expect(svc.query('SELECT bad')).rejects.toThrow('bad sql');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
