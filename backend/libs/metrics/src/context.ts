// Per-invocation request context propagated via AsyncLocalStorage so deep call sites
// (e.g. AuroraService) can stamp the client requestId on their metrics without threading
// it through every function signature. Set once at the top of a Lambda handler.
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId?: string;
  field?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentContext(): RequestContext {
  return storage.getStore() ?? {};
}

/** The current requestId as an EMF property bag, or undefined when unknown. */
export function requestProperties(): Record<string, string> | undefined {
  const { requestId } = currentContext();
  return requestId ? { requestId } : undefined;
}
