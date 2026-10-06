import type { URI } from '@oi/base';
import type { IFileService } from './fs';
import type { IChannel } from './ipc/channel';
import { FILE_RPC_METHODS } from './ipc/protocol';

interface FileUriParams {
  readonly uri: string;
}

interface WriteFileParams extends FileUriParams {
  readonly content: string;
}

/**
 * {@link IFileService} 的 JSON-RPC 客户端代理：
 * 渲染进程与扩展宿主经此访问主进程文件能力，自身不接触 Node API。
 */
export class FileServiceClient implements IFileService {
  constructor(private readonly _channel: IChannel) {}

  readFile(uri: URI): Promise<string> {
    const params: FileUriParams = { uri: uri.toString() };
    return this._channel.call<string>(FILE_RPC_METHODS.readFile, params);
  }

  async writeFile(uri: URI, content: string): Promise<void> {
    const params: WriteFileParams = { uri: uri.toString(), content };
    await this._channel.call(FILE_RPC_METHODS.writeFile, params);
  }

  exists(uri: URI): Promise<boolean> {
    const params: FileUriParams = { uri: uri.toString() };
    return this._channel.call<boolean>(FILE_RPC_METHODS.exists, params);
  }
}
