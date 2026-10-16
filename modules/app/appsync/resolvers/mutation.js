// pipeline resolver wrapper: mutations. per-mutation overrides go in
// resolvers/custom/Mutation.<field>.js (used when the schema gains mutations).
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  return {};
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.prev.result;
}
