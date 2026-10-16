// Glean chat streaming Lambda. Its own deployment (response streaming + REST API
// STREAM mode + non-VPC egress); it constructs GleanService directly over its
// own AuroraService for token custody and chat streaming.
//
// The HttpResponseStream.from() prelude (status + headers) is REQUIRED — without it
// API Gateway returns a 500 for streaming integrations. Wrapped in
// awslambda.streamifyResponse (Node runtime global).
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { once } from '@libs/di';
import { AuroraService, auroraConfigFromEnv } from '@libs/aurora';
import { GleanError, GleanService } from '@libs/glean';

interface ResponseStream {
  write: (chunk: string) => void;
  end: () => void;
}

declare const awslambda: {
  streamifyResponse: (
    fn: (event: unknown, responseStream: ResponseStream) => Promise<void>,
  ) => unknown;
  HttpResponseStream: {
    from: (
      stream: ResponseStream,
      prelude: { statusCode: number; headers: Record<string, string> },
    ) => ResponseStream;
  };
};

// SSE keepalive cadence — periodic during a quiet Glean stretch so the CloudFront /
// API Gateway idle timers never fire mid-stream (ported from core.mjs HEARTBEAT_MS).
const HEARTBEAT_MS = 10_000;

/** SSE frame for a text delta. JSON-encoded so embedded newlines survive the
 *  line-oriented SSE wire format (the SPA JSON-parses each data line). */
function sseData(text: string): string {
  return `data: ${JSON.stringify(text)}\n\n`;
}

/** SSE frame for a named control event (thinking / done / error). */
function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data ?? '')}\n\n`;
}

/** SSE comment — a keepalive ignored by parsers but resets the idle timers. */
const SSE_HEARTBEAT = ': ping\n\n';

interface Claims {
  email?: string;
  sub?: string;
}

interface StreamEvent {
  body?: string;
  isBase64Encoded?: boolean;
  requestContext?: { authorizer?: { claims?: Claims } };
}

function readPrompt(event: StreamEvent): string {
  let body = event?.body ?? '';
  if (event?.isBase64Encoded && body) body = Buffer.from(body, 'base64').toString('utf8');
  try {
    return (JSON.parse(body) as { prompt?: string })?.prompt ?? '';
  } catch {
    return '';
  }
}

// GleanService is built ONCE and reused across warm invocations (once() memoizes it),
// sharing its AuroraService. Lazy so importing this module (e.g. a test) constructs nothing.
const gleanService = once(() => new GleanService(new AuroraService(new RDSDataClient({}), auroraConfigFromEnv())));

export const handler = awslambda.streamifyResponse(async (rawEvent: unknown, responseStream: ResponseStream) => {
  const event = (rawEvent ?? {}) as StreamEvent;
  // Keep-alive warmer ping: close immediately, before any Aurora/Glean work.
  if ((rawEvent as { warmup?: boolean })?.warmup === true) {
    responseStream.end();
    return;
  }
  const claims = event?.requestContext?.authorizer?.claims ?? {};
  const prompt = readPrompt(event);

  const stream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    },
  });

  // Flush a heartbeat first so the client sees bytes before the DI/token round-trip
  // (covers that latency under the idle timers), then keep pinging while Glean is quiet.
  let ticker: ReturnType<typeof setInterval> | null = null;
  try {
    if (!prompt) throw new GleanError('TRANSIENT', 'missing prompt');
    stream.write(SSE_HEARTBEAT);
    const glean = gleanService();
    const owner = await glean.ownerId(claims.email, claims.sub);
    console.log('[glean] stream.start');
    ticker = setInterval(() => stream.write(SSE_HEARTBEAT), HEARTBEAT_MS);
    for await (const { content, thinking } of glean.streamChat(owner, prompt)) {
      if (thinking) stream.write(sseEvent('thinking', thinking));
      if (content) stream.write(sseData(content));
    }
    console.log('[glean] stream.done');
    stream.write(sseEvent('done', {}));
  } catch (e) {
    // Structured so the SPA reacts on the code (reconnect vs transient) rather
    // than parsing the human message.
    const code = e instanceof GleanError ? e.code : 'TRANSIENT';
    const message = e instanceof Error ? e.message : String(e);
    const status = e instanceof GleanError ? e.httpStatus : undefined;
    console.log(`[glean] stream.error code=${code}${status ? ` status=${status}` : ''}`);
    stream.write(sseEvent('error', { code, message }));
  } finally {
    if (ticker) clearInterval(ticker);
    stream.end();
  }
});
