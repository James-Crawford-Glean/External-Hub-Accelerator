// pipeline resolver wrapper: list-returning queries.
// before: pass through. after: unwrap {items, nextToken} envelope when present.
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  return {};
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const r = ctx.prev.result;
  return r && typeof r === 'object' && Array.isArray(r.items) ? r.items : r;
}
