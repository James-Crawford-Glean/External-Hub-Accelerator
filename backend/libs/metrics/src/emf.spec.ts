import { emitEmf, emitDuration, startTimer, PERF_NAMESPACE } from './emf';

describe('emitEmf', () => {
  let logSpy: jest.SpyInstance;
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, APP_ENV: 'dev', APP_VERSION: 'abc1234' };
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.env = ORIGINAL_ENV;
  });

  it('emits a single EMF line with release dimensions, properties, and metric value', () => {
    emitEmf({
      namespace: 'Portal/Perf',
      metrics: [{ name: 'ResolverDuration', value: 42, unit: 'Milliseconds' }],
      dimensions: { field: 'partners', ok: 'true' },
      properties: { requestId: 'req-1' },
      timestamp: 1719000000000,
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(logSpy.mock.calls[0][0] as string);
    const meta = line._aws.CloudWatchMetrics[0];

    expect(line._aws.Timestamp).toBe(1719000000000);
    expect(meta.Namespace).toBe('Portal/Perf');
    // env is a dimension; version is a property (not a dimension) to avoid cardinality cost
    expect(meta.Dimensions[0]).toEqual(['env', 'field', 'ok']);
    expect(meta.Metrics[0]).toEqual({ Name: 'ResolverDuration', Unit: 'Milliseconds' });
    expect(line.env).toBe('dev');
    expect(line.version).toBe('abc1234'); // present on the line as a property
    expect(line.field).toBe('partners');
    expect(line.requestId).toBe('req-1');
    expect(line.ResolverDuration).toBe(42);
  });

  it('defaults env/version to "unknown" when unset and unit to "None"', () => {
    delete process.env.APP_ENV;
    delete process.env.APP_VERSION;

    emitEmf({ namespace: 'X', metrics: [{ name: 'M', value: 1 }] });

    const line = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(line.env).toBe('unknown');
    expect(line.version).toBe('unknown');
    expect(line._aws.CloudWatchMetrics[0].Metrics[0].Unit).toBe('None');
  });

  it('never throws and logs nothing when the payload is not serializable', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() =>
      emitEmf({ namespace: 'X', metrics: [{ name: 'M', value: 1 }], properties: circular as never }),
    ).not.toThrow();
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe('emitDuration', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => logSpy.mockRestore());

  it('rounds milliseconds and uses the Portal/Perf namespace', () => {
    emitDuration('AuroraCallDuration', 12.7, { kind: 'query' }, { requestId: 'r' });

    const line = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(line.AuroraCallDuration).toBe(13);
    expect(line._aws.CloudWatchMetrics[0].Namespace).toBe(PERF_NAMESPACE);
    expect(line._aws.CloudWatchMetrics[0].Metrics[0].Unit).toBe('Milliseconds');
    expect(line.kind).toBe('query');
  });
});

describe('startTimer', () => {
  it('returns non-negative elapsed milliseconds', () => {
    const timer = startTimer();
    const elapsed = timer.stop();
    expect(typeof elapsed).toBe('number');
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });
});
