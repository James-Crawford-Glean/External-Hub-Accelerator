import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { WorkerService } from './worker.service';

function fakeClient(sendImpl: (cmd: any) => any) {
  const send = jest.fn(async (cmd: any) => sendImpl(cmd));
  return { client: { send } as unknown as LambdaClient, send };
}

describe('WorkerService.invokeAsync', () => {
  it('sends an Event invocation with a JSON-encoded payload and returns true', async () => {
    const { client, send } = fakeClient(() => ({}));
    const svc = new WorkerService(client);
    const ok = await svc.invokeAsync('my-fn', { entity: 'sf_accounts', id: 'acc_1' });
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(InvokeCommand);
    expect(cmd.input.FunctionName).toBe('my-fn');
    expect(cmd.input.InvocationType).toBe('Event');
    expect(Buffer.from(cmd.input.Payload).toString('utf-8')).toBe(
      JSON.stringify({ entity: 'sf_accounts', id: 'acc_1' }),
    );
  });

  it('defaults the payload to {} when none is given', async () => {
    const { client, send } = fakeClient(() => ({}));
    const svc = new WorkerService(client);
    const ok = await svc.invokeAsync('my-fn');
    expect(ok).toBe(true);
    expect(Buffer.from(send.mock.calls[0][0].input.Payload).toString('utf-8')).toBe('{}');
  });

  it('returns false and issues no invoke when the function name is empty', async () => {
    const { client, send } = fakeClient(() => ({}));
    const svc = new WorkerService(client);
    expect(await svc.invokeAsync('')).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('swallows invoke errors and returns false', async () => {
    const { client, send } = fakeClient(() => {
      throw new Error('throttled');
    });
    const svc = new WorkerService(client);
    expect(await svc.invokeAsync('my-fn', { a: 1 })).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
