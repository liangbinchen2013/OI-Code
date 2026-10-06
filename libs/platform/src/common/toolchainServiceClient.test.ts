import { Emitter, URI } from '@oi/base';
import { describe, expect, it } from 'vitest';
import { type IMessageTransport, RpcChannel } from './ipc/channel';
import { TOOLCHAIN_RPC_METHODS, TOOLCHAIN_RPC_NOTIFICATIONS } from './ipc/protocol';
import { ToolchainServiceClient } from './toolchainServiceClient';
import type { ISearchProgress } from './toolchain';

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

describe('ToolchainServiceClient', () => {
  it('compile 透传参数并把线格式诊断还原为 URI', async () => {
    const [left, right] = createPipe();
    const client = new ToolchainServiceClient(new RpcChannel(left));
    const server = new RpcChannel(right);
    let received: unknown;
    server.registerMethod(TOOLCHAIN_RPC_METHODS.compile, (params) => {
      received = params;
      return {
        ok: false,
        durationMs: 120,
        diagnostics: [
          {
            severity: 'error',
            message: "expected ';'",
            line: 3,
            column: 5,
            fileName: 'T1.cpp',
            uri: URI.file('C:/problems/T1.cpp').toString(),
          },
        ],
        message: '编译失败',
      };
    });

    const result = await client.compile({
      uri: URI.file('C:/problems/T1.cpp'),
      content: 'int main() {}',
      standard: 'c++17',
    });

    expect(received).toEqual({
      uri: 'file:///C:/problems/T1.cpp',
      content: 'int main() {}',
      standard: 'c++17',
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.uri?.fsPath).toBe('C:/problems/T1.cpp');
    expect(result.diagnostics[0]?.line).toBe(3);

    client.dispose();
    server.dispose();
  });

  it('search 进度通知驱动 onDidSearchProgress 事件', async () => {
    const [left, right] = createPipe();
    const client = new ToolchainServiceClient(new RpcChannel(left));
    const server = new RpcChannel(right);
    const progresses: ISearchProgress[] = [];
    client.onDidSearchProgress((progress) => progresses.push(progress));

    server.notify(TOOLCHAIN_RPC_NOTIFICATIONS.searchProgress, {
      phase: 'probing',
      detail: 'C++23',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(progresses).toEqual([{ phase: 'probing', detail: 'C++23' }]);

    client.dispose();
    server.dispose();
  });

  it('check 返回诊断列表且 run 返回启动结果', async () => {
    const [left, right] = createPipe();
    const client = new ToolchainServiceClient(new RpcChannel(left));
    const server = new RpcChannel(right);
    server.registerMethod(TOOLCHAIN_RPC_METHODS.check, () => []);
    server.registerMethod(TOOLCHAIN_RPC_METHODS.run, () => ({ launched: true }));

    await expect(client.check(URI.file('C:/a.cpp'), 'x')).resolves.toEqual([]);
    await expect(client.run(URI.file('C:/a.cpp'))).resolves.toEqual({ launched: true });

    client.dispose();
    server.dispose();
  });
});
