import { URI } from '@oi/base';
import type { IFileDialogService, IOpenFileDialogOptions } from './dialog';
import type { IChannel } from './ipc/channel';
import { DIALOG_RPC_METHODS } from './ipc/protocol';

/**
 * {@link IFileDialogService} 的 JSON-RPC 客户端代理。
 */
export class FileDialogServiceClient implements IFileDialogService {
  constructor(private readonly _channel: IChannel) {}

  async showOpenFile(options?: IOpenFileDialogOptions): Promise<URI | undefined> {
    const result = await this._channel.call<string | undefined>(DIALOG_RPC_METHODS.showOpenFile, {
      options,
    });
    return result === undefined ? undefined : URI.parse(result);
  }

  confirmDiscardChanges(fileName?: string): Promise<boolean> {
    return this._channel.call<boolean>(DIALOG_RPC_METHODS.confirmDiscardChanges, { fileName });
  }
}
