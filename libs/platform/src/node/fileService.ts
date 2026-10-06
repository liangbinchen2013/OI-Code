import { access, readFile, writeFile } from 'node:fs/promises';
import { type URI, toError } from '@oi/base';
import type { IFileService } from '../common/fs';

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}

/**
 * Node 侧文件服务：仅接受 file scheme，内容按 UTF-8 读写。
 */
export class NodeFileService implements IFileService {
  async readFile(uri: URI): Promise<string> {
    const path = this._toPath(uri);
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      throw new Error(`读取文件失败：${path}（${toError(error).message}）`, { cause: error });
    }
  }

  async writeFile(uri: URI, content: string): Promise<void> {
    const path = this._toPath(uri);
    try {
      await writeFile(path, content, 'utf8');
    } catch (error) {
      throw new Error(`写入文件失败：${path}（${toError(error).message}）`, { cause: error });
    }
  }

  async exists(uri: URI): Promise<boolean> {
    const path = this._toPath(uri);
    try {
      await access(path);
      return true;
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        return false;
      }
      throw new Error(`检查文件失败：${path}（${toError(error).message}）`, { cause: error });
    }
  }

  private _toPath(uri: URI): string {
    if (uri.scheme !== 'file') {
      throw new Error(`不支持的文件 URI：${uri.toString()}`);
    }
    return uri.fsPath;
  }
}
