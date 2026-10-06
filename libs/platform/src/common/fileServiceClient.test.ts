import { mkdtemp, readFile as fsReadFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URI, Emitter } from '@oi/base';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFileService } from '../node/fileService';
import { FileServiceClient } from './fileServiceClient';
import { type IMessageTransport, RpcChannel } from './ipc/channel';
import { FILE_RPC_METHODS, RpcError } from './ipc/protocol';

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

function registerNodeFileHandlers(server: RpcChannel, fileService: NodeFileService): void {
  server.registerMethod(FILE_RPC_METHODS.readFile, (params) => {
    const { uri } = params as { uri: string };
    return fileService.readFile(URI.parse(uri));
  });
  server.registerMethod(FILE_RPC_METHODS.writeFile, (params) => {
    const { uri, content } = params as { uri: string; content: string };
    return fileService.writeFile(URI.parse(uri), content);
  });
  server.registerMethod(FILE_RPC_METHODS.exists, (params) => {
    const { uri } = params as { uri: string };
    return fileService.exists(URI.parse(uri));
  });
}

describe('FileServiceClient', () => {
  let directory: string;
  let client: FileServiceClient;
  let clientChannel: RpcChannel;
  let server: RpcChannel;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'oi-code-rpc-fs-'));
    const [left, right] = createPipe();
    clientChannel = new RpcChannel(left);
    server = new RpcChannel(right);
    registerNodeFileHandlers(server, new NodeFileService());
    client = new FileServiceClient(clientChannel);
  });

  afterEach(async () => {
    clientChannel.dispose();
    server.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  it('经 RPC 写入后真实落盘并可读回', async () => {
    const uri = URI.file(join(directory, 'main.cpp'));

    await client.writeFile(uri, '#include <iostream>\n');
    await expect(client.readFile(uri)).resolves.toBe('#include <iostream>\n');
    await expect(fsReadFile(uri.fsPath, 'utf8')).resolves.toBe('#include <iostream>\n');
    await expect(client.exists(uri)).resolves.toBe(true);
  });

  it('远端错误以 RpcError 拒绝且保留原因', async () => {
    const missing = URI.file(join(directory, 'missing.cpp'));

    const rejection = await client.readFile(missing).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(RpcError);
    expect((rejection as RpcError).message).toMatch(/读取文件失败：.*missing\.cpp/);
  });
});
