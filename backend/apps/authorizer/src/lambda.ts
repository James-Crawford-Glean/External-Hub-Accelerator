// Unified Lambda authorizer entry. One function, both callers: AppSync (Lambda
// authorizer) and the API Gateway v2 HTTP API (REQUEST authorizer). Validates the
// bearer (Cognito JWT for people, opaque key for machines) and returns the caller's
// principal in the authorizer context. Wiring AppSync/API Gateway to use it is a
// follow-up; this deployment just makes the function exist.
import { authorize } from './authorize';
import { credentials } from './container';

export async function handler(event: unknown): Promise<unknown> {
  return authorize(event, (bearer) => credentials().verify(bearer));
}
