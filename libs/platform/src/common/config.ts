import { createDecorator } from './instantiation';

/**
 * 配置存储契约：键为点分字符串，值为 JSON 可序列化数据。
 * 实现负责持久化与并发写入串行化。
 */
export interface IConfigService {
  /** 读取指定键；未设置时返回 undefined。 */
  get(key: string): Promise<unknown>;
  /** 写入指定键并落盘；写失败时 promise 拒绝。 */
  set(key: string, value: unknown): Promise<void>;
}

export const IConfigService = createDecorator<IConfigService>('configService');
