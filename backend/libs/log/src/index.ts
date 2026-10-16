// Tiny level-gated logger with a familiar call surface (new Logger(context);
// .log/.warn/.error), one line per call to stdout/stderr so
// CloudWatch ingests it as a single event. Level via LOG_LEVEL (error|warn|log|debug),
// default 'log' — 'debug' is the only level off by default.
type Level = 'error' | 'warn' | 'log' | 'debug';
const RANK: Record<Level, number> = { error: 0, warn: 1, log: 2, debug: 3 };

function threshold(): number {
  const env = (process.env.LOG_LEVEL ?? 'log').toLowerCase() as Level;
  return RANK[env] ?? RANK.log;
}

function emit(level: Level, ctx: string, args: unknown[]): void {
  if (RANK[level] > threshold()) return;
  const prefix = ctx ? `[${ctx}]` : '';
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(`${level.toUpperCase()} ${prefix}`, ...args);
}

export class Logger {
  constructor(private readonly ctx: string = '') {}
  error(...args: unknown[]): void {
    emit('error', this.ctx, args);
  }
  warn(...args: unknown[]): void {
    emit('warn', this.ctx, args);
  }
  log(...args: unknown[]): void {
    emit('log', this.ctx, args);
  }
  debug(...args: unknown[]): void {
    emit('debug', this.ctx, args);
  }
}
