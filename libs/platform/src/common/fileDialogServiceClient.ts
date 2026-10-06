import { URI } from '@oi/base';
import type { IFileDialogService, IOpenFileDialogOptions, ISaveFileDialogOptions } from './dialog';
import type { IChannel } from './ipc/channel';
import { DIALOG_RPC_METHODS } from './ipc/protocol';

/**
 * {@link IFileDialogService} 的 JSON-RPC 客户端代理。
 */
export class FileDialogServiceClient implements IFileDialogService {
  constructor(private readonly _channel: IChannel) {}

  async showOpenFile(options?: IOpenFileDialogOptions): Promise<URI | undefined> {
    return this._parseUriResult(
      await this._channel.call<string | undefined>(DIALOG_RPC_METHODS.showOpenFile, { options }),
    );
  }

  async showOpenFolder(options?: IOpenFileDialogOptions): Promise<URI | undefined> {
    return this._parseUriResult(
      await this._channel.call<string | undefined>(DIALOG_RPC_METHODS.showOpenFolder, { options }),
    );
  }

  async showSaveFile(options?: ISaveFileDialogOptions): Promise<URI | undefined> {
    return this._parseUriResult(
      await this._channel.call<string | undefined>(DIALOG_RPC_METHODS.showSaveFile, { options }),
    );
  }

  confirmDiscardChanges(fileName?: string): Promise<boolean> {
    return this._channel.call<boolean>(DIALOG_RPC_METHODS.confirmDiscardChanges, { fileName });
  }

  private _parseUriResult(result: string | undefined): URI | undefined {
    return result === undefined ? undefined : URI.parse(result);
  }
}
