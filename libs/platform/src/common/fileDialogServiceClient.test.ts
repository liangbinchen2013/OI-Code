import { Emitter, URI } from '@oi/base';
import { describe, expect, it } from 'vitest';
import { FileDialogServiceClient } from './fileDialogServiceClient';
import { type IMessageTransport, RpcChannel } from './ipc/channel';
import { DIALOG_RPC_METHODS } from './ipc/protocol';

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

describe('FileDialogServiceClient', () => {
  it('showOpenFile 返回解析后的 URI 并透传选项', async () => {
    const [left, right] = createPipe();
    const channel = new RpcChannel(left);
    const client = new FileDialogServiceClient(channel);
    const server = new RpcChannel(right);
    let received: unknown;
    server.registerMethod(DIALOG_RPC_METHODS.showOpenFile, (params) => {
      received = params;
      return URI.file('C:/problems/a.cpp').toString();
    });

    const uri = await client.showOpenFile({
      title: '打开题解',
      filters: [{ name: 'C++', extensions: ['cpp'] }],
    });

    expect(uri?.fsPath).toBe('C:/problems/a.cpp');
    expect(received).toEqual({
      options: { title: '打开题解', filters: [{ name: 'C++', extensions: ['cpp'] }] },
    });

    channel.dispose();
    server.dispose();
  });

  it('用户取消时返回 undefined', async () => {
    const [left, right] = createPipe();
    const client = new FileDialogServiceClient(new RpcChannel(left));
    const server = new RpcChannel(right);
    server.registerMethod(DIALOG_RPC_METHODS.showOpenFile, () => undefined);

    await expect(client.showOpenFile()).resolves.toBeUndefined();

    server.dispose();
  });

  it('confirmDiscardChanges 透传文件名并返回确认结果', async () => {
    const [left, right] = createPipe();
    const client = new FileDialogServiceClient(new RpcChannel(left));
    const server = new RpcChannel(right);
    let received: unknown;
    server.registerMethod(DIALOG_RPC_METHODS.confirmDiscardChanges, (params) => {
      received = params;
      return true;
    });

    await expect(client.confirmDiscardChanges('main.cpp')).resolves.toBe(true);
    expect(received).toEqual({ fileName: 'main.cpp' });

    server.dispose();
  });
});
