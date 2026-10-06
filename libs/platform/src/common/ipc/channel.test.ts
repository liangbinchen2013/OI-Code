import { Emitter, setUnexpectedErrorHandler } from '@oi/base';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type IMessageTransport, RpcChannel } from './channel';
import { APP_RPC_ERROR_CODES, JSON_RPC_ERROR_CODES, RpcError } from './protocol';

afterEach(() => {
  setUnexpectedErrorHandler(undefined);
});

function createPipe(): [IMessageTransport, IMessageTransport] {
  const leftEmitter = new Emitter<unknown>();
  const rightEmitter = new Emitter<unknown>();
  const left: IMessageTransport = {
    onMessage: leftEmitter.event,
    send: (message) => queueMicrotask(() => rightEmitter.fire(message)),
  };
  const right: IMessageTransport = {
    onMessage: rightEmitter.event,
    send: (message) => queueMicrotask(() => leftEmitter.fire(message)),
  };
  return [left, right];
}

describe('RpcChannel', () => {
  it('调用远端注册的方法并返回结果', async () => {
    const [left, right] = createPipe();
    const client = new RpcChannel(left);
    const server = new RpcChannel(right);
    server.registerMethod('add', (params) => {
      const { a, b } = params as { a: number; b: number };
      return a + b;
    });

    await expect(client.call<number>('add', { a: 1, b: 2 })).resolves.toBe(3);

    client.dispose();
    server.dispose();
  });

  it('远端方法抛错时以 RpcError 拒绝', async () => {
    const [left, right] = createPipe();
    const client = new RpcChannel(left);
    const server = new RpcChannel(right);
    server.registerMethod('fail', () => {
      throw new Error('handler failed');
    });

    const rejection = await client.call('fail').catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(RpcError);
    expect((rejection as RpcError).code).toBe(JSON_RPC_ERROR_CODES.internalError);
    expect((rejection as RpcError).message).toBe('handler failed');

    client.dispose();
    server.dispose();
  });

  it('处理器抛出的 RpcError 错误码与数据原样透传', async () => {
    const [left, right] = createPipe();
    const client = new RpcChannel(left);
    const server = new RpcChannel(right);
    server.registerMethod('get', () => {
      throw new RpcError(APP_RPC_ERROR_CODES.accessDenied, '拒绝访问', { path: 'C:/secret.txt' });
    });

    const rejection = await client.call('get').catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(RpcError);
    expect((rejection as RpcError).code).toBe(APP_RPC_ERROR_CODES.accessDenied);
    expect((rejection as RpcError).data).toEqual({ path: 'C:/secret.txt' });

    client.dispose();
    server.dispose();
  });

  it('调用未注册方法返回 methodNotFound', async () => {
    const [left, right] = createPipe();
    const client = new RpcChannel(left);
    const server = new RpcChannel(right);

    const rejection = await client.call('missing').catch((error: unknown) => error);

    expect((rejection as RpcError).code).toBe(JSON_RPC_ERROR_CODES.methodNotFound);

    client.dispose();
    server.dispose();
  });

  it('通知触发对应监听器', async () => {
    const [left, right] = createPipe();
    const client = new RpcChannel(left);
    const server = new RpcChannel(right);
    const listener = vi.fn();
    server.listen('progress', listener);

    client.notify('progress', { percent: 50 });
    await Promise.resolve();

    expect(listener).toHaveBeenCalledWith({ percent: 50 });

    client.dispose();
    server.dispose();
  });

  it('重复注册同一方法抛出', () => {
    const emitter = new Emitter<unknown>();
    const channel = new RpcChannel({ onMessage: emitter.event, send: () => undefined });
    channel.registerMethod('dup', () => undefined);

    expect(() => channel.registerMethod('dup', () => undefined)).toThrow(/已注册/);

    channel.dispose();
  });

  it('释放时拒绝未完成调用，且释放后不再接受调用', async () => {
    const [left, right] = createPipe();
    const client = new RpcChannel(left);
    const server = new RpcChannel(right);
    server.registerMethod('never', () => new Promise(() => undefined));

    const pending = client.call('never');
    client.dispose();

    await expect(pending).rejects.toThrow(/已释放/);
    await expect(client.call('never')).rejects.toThrow(/已释放/);

    server.dispose();
  });

  it('无法识别的消息交给 onUnexpectedError', async () => {
    const errors: unknown[] = [];
    setUnexpectedErrorHandler((error) => errors.push(error));
    const [left, right] = createPipe();
    const client = new RpcChannel(left);
    const server = new RpcChannel(right);

    right.send(42);
    await Promise.resolve();

    expect(errors).toHaveLength(1);

    client.dispose();
    server.dispose();
  });
});
