// Async Lambda invocation helper: fire-and-forget Event invocations. Never
// raises; reports success via the return value so a background kickoff can't
// 500 its caller. The client is constructor-
// injected so tests pass a fake; env is read lazily, never at module load.
import { Logger } from '@libs/log';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

export class WorkerService {
  private readonly log = new Logger(WorkerService.name);

  constructor(private readonly client: LambdaClient = new LambdaClient({})) {}

  /** Fire-and-forget Event invocation of `functionName`. Never raises — a failed
   *  invoke (empty name, network blip, throttle, IAM denial) is logged and reported
   *  via the return value.
   *
   *  Returns true once dispatched; false when functionName is empty (no-op) or the
   *  invoke failed. Callers that persist a job row should treat false as "worker not
   *  started". Payload defaults to '{}' when null/undefined. */
  async invokeAsync(functionName: string, payload?: Record<string, unknown> | null): Promise<boolean> {
    if (!functionName) return false;
    const body = payload != null ? Buffer.from(JSON.stringify(payload), 'utf-8') : Buffer.from('{}');
    try {
      await this.client.send(
        new InvokeCommand({ FunctionName: functionName, InvocationType: 'Event', Payload: body }),
      );
      return true;
    } catch (e) {
      // fire-and-forget: log and continue, never propagate to the caller.
      this.log.error(`worker.invoke_async_error fn=${functionName}`, e as Error);
      return false;
    }
  }
}
