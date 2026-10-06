import type { URI } from '@oi/base';
import { createDecorator } from './instantiation';

/**
 * 文件读写契约：资源一律以 URI 定位。
 * 渲染进程与扩展宿主侧由 JSON-RPC 代理实现（见 fileServiceClient）。
 */
export interface IFileService {
  readFile(uri: URI): Promise<string>;
  writeFile(uri: URI, content: string): Promise<void>;
  exists(uri: URI): Promise<boolean>;
}

export const IFileService = createDecorator<IFileService>('fileService');
