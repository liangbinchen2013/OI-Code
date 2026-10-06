import { Emitter, URI } from '@oi/base';
import { describe, expect, it } from 'vitest';
import { type IMessageTransport, RpcChannel } from './ipc/channel';
import { PYTHON_RPC_METHODS, PYTHON_RPC_NOTIFICATIONS } from './ipc/protocol';
import { PythonServiceClient } from './pythonServiceClient';
import type { IPipOutputChunk } from './python';

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

describe('PythonServiceClient', () => {
  it('pipInstall 透传请求并返回结果', async () => {
    const [left, right] = createPipe();
    const client = new PythonServiceClient(new RpcChannel(left));
    const server = new RpcChannel(right);
    let received: unknown;
    server.registerMethod(PYTHON_RPC_METHODS.pipInstall, (params) => {
      received = params;
      return { ok: true, exitCode: 0, message: '安装完成' };
    });

    const result = await client.pipInstall({
      packageName: 'numpy',
      version: '2.1.0',
      useTsinghuaMirror: true,
    });

    expect(received).toEqual({
      packageName: 'numpy',
      version: '2.1.0',
      useTsinghuaMirror: true,
    });
    expect(result.ok).toBe(true);

    client.dispose();
    server.dispose();
  });

  it('pip 输出与搜索进度通知驱动事件', async () => {
    const [left, right] = createPipe();
    const client = new PythonServiceClient(new RpcChannel(left));
    const server = new RpcChannel(right);
    const chunks: IPipOutputChunk[] = [];
    const details: string[] = [];
    client.onDidPipOutput((chunk) => chunks.push(chunk));
    client.onDidSearchProgress((progress) => details.push(progress.detail ?? ''));

    server.notify(PYTHON_RPC_NOTIFICATIONS.pipOutput, {
      stream: 'stdout',
      chunk: 'Looking in indexes',
    });
    server.notify(PYTHON_RPC_NOTIFICATIONS.searchProgress, {
      phase: 'probing',
      detail: 'C:/Python313/python.exe',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chunks).toEqual([{ stream: 'stdout', chunk: 'Looking in indexes' }]);
    expect(details).toEqual(['C:/Python313/python.exe']);

    client.dispose();
    server.dispose();
  });

  it('check 返回线格式诊断并还原 URI', async () => {
    const [left, right] = createPipe();
    const client = new PythonServiceClient(new RpcChannel(left));
    const server = new RpcChannel(right);
    server.registerMethod(PYTHON_RPC_METHODS.check, () => [
      {
        severity: 'error',
        message: 'invalid syntax',
        line: 1,
        column: 8,
        fileName: 'T1.py',
        uri: URI.file('C:/problems/T1.py').toString(),
      },
    ]);

    const diagnostics = await client.check(URI.file('C:/problems/T1.py'), 'def f(:');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.uri?.fsPath).toBe('C:/problems/T1.py');
    expect(diagnostics[0]?.column).toBe(8);

    client.dispose();
    server.dispose();
  });
});
