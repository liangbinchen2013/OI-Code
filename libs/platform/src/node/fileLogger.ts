import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { type ILogger, type LogEntry, type LogLevel, formatLogLine } from '../common/log';

/**
 * 文件日志落点：追加写入指定文件，目录不存在时自动创建。
 * 写入失败降级到 stderr，避免日志问题影响主流程。
 */
export class FileLogger implements ILogger {
  private readonly _stream: WriteStream;
  private _isDisposed = false;

  constructor(filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this._stream = createWriteStream(filePath, { flags: 'a' });
    this._stream.on('error', (error: Error) => {
      process.stderr.write(`FileLogger 写入失败：${error.message}\n`);
    });
  }

  write(level: LogLevel, message: string, args: readonly unknown[]): void {
    if (this._isDisposed) {
      return;
    }
    const entry: LogEntry = { level, message, args };
    this._stream.write(`${new Date().toISOString()} ${formatLogLine(entry)}\n`);
  }

  flush(): Promise<void> {
    return new Promise((resolve) => {
      if (this._isDisposed) {
        resolve();
        return;
      }
      this._stream.write('', () => resolve());
    });
  }

  dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    this._stream.end();
  }
}
