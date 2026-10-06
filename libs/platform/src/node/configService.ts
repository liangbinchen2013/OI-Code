import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { toError } from '@oi/base';
import { ILogService } from '../common/log';
import type { IConfigService } from '../common/config';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}

/**
 * JSON 文件配置存储：内存缓存 + 串行落盘（临时文件 + 原子替换）。
 * 配置文件缺失时视为空配置；损坏时告警并回退为空，避免阻塞应用启动。
 */
export class JsonConfigService implements IConfigService {
  private _loadPromise: Promise<Record<string, unknown>> | undefined;
  private _writeChain: Promise<void> = Promise.resolve();

  constructor(
    @ILogService private readonly _logService: ILogService,
    private readonly _filePath: string,
  ) {}

  async get(key: string): Promise<unknown> {
    const data = await this._load();
    return data[key];
  }

  async set(key: string, value: unknown): Promise<void> {
    const data = await this._load();
    data[key] = value;
    const snapshot = { ...data };
    this._writeChain = this._writeChain.then(
      () => this._persist(snapshot),
      () => this._persist(snapshot),
    );
    await this._writeChain;
  }

  private _load(): Promise<Record<string, unknown>> {
    this._loadPromise ??= this._doLoad();
    return this._loadPromise;
  }

  private async _doLoad(): Promise<Record<string, unknown>> {
    try {
      const text = await readFile(this._filePath, 'utf8');
      const parsed: unknown = JSON.parse(text);
      return isRecord(parsed) ? parsed : {};
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) {
        this._logService.warn(`配置文件读取失败，已回退为空配置：${this._filePath}`, error);
      }
      return {};
    }
  }

  private async _persist(data: Record<string, unknown>): Promise<void> {
    const temporaryPath = `${this._filePath}.tmp`;
    try {
      await mkdir(dirname(this._filePath), { recursive: true });
      await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      await rename(temporaryPath, this._filePath);
    } catch (error) {
      throw new Error(`配置写入失败：${this._filePath}（${toError(error).message}）`, {
        cause: error,
      });
    }
  }
}
