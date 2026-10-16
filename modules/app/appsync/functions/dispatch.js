// shared pipeline function: invokes the dispatcher Lambda. all resolvers
// chain this; future middleware (require_admin, audit_log, throttle) lands
// as additional functions composed before/after this one in pipeline_config.
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  // Under the Lambda authorizer, ctx.identity.resolverContext carries the resolved
  // principal (kind + email/sub/name for people, keyId + scopes for keys). AWS_IAM
  // callers have no resolverContext — they fall through to an empty identity, which
  // the resolvers treat as an unroostered principal.
  const rc = (ctx.identity && ctx.identity.resolverContext) || {};
  return {
    operation: 'Invoke',
    payload: {
      typeName: ctx.info.parentTypeName,
      fieldName: ctx.info.fieldName,
      arguments: ctx.arguments,
      source: ctx.source,
      identity: {
        kind: rc.kind || 'user',
        sub: rc.sub || null,
        email: rc.email || null,
        name: rc.name || rc.email || null,
        keyId: rc.keyId || null,
        // '' is present, and authz reads a present scopes value with no write as a read-only cap.
        scopes: rc.scopes || null,
      },
    },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result;  // flows to next pipeline function or resolver after
}
