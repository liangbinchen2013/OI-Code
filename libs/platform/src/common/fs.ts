import type { URI } from '@oi/base';
import { createDecorator } from './instantiation';

/**
 * 文件系统条目类型。
 */
export type FileSystemEntryKind = 'file' | 'directory';

/**
 * 目录项：uri 由主进程直接给出，渲染进程无需自行拼接路径。
 */
export interface IFileSystemEntry {
  readonly name: string;
  readonly kind: FileSystemEntryKind;
  readonly uri: URI;
}

/**
 * 文件读写契约：资源一律以 URI 定位。
 * 渲染进程与扩展宿主侧由 JSON-RPC 代理实现（见 fileServiceClient）。
 */
export interface IFileService {
  readFile(uri: URI): Promise<string>;
  writeFile(uri: URI, content: string): Promise<void>;
  exists(uri: URI): Promise<boolean>;
  readDirectory(uri: URI): Promise<IFileSystemEntry[]>;
}

export const IFileService = createDecorator<IFileService>('fileService');
