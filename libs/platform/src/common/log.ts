import { type IDisposable, onUnexpectedError, toDisposable } from '@oi/base';
import { createDecorator } from './instantiation';

/**
 * 日志级别，数值越大越严重。
 */
export enum LogLevel {
  Trace = 0,
  Debug = 1,
  Info = 2,
  Warn = 3,
  Error = 4,
  Off = 5,
}

/**
 * 日志落点：文件、IPC 转发等具体实现由各环境提供。
 */
export interface ILogger extends IDisposable {
  write(level: LogLevel, message: string, args: readonly unknown[]): void;
  flush(): Promise<void>;
}

/**
 * 统一日志契约：禁止 `console.*`，一律经此接口。
 */
export interface ILogService extends IDisposable {
  getLevel(): LogLevel;
  setLevel(level: LogLevel): void;
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(error: Error | string, ...args: unknown[]): void;
}

export const ILogService = createDecorator<ILogService>('logService');

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.Trace]: 'TRACE',
  [LogLevel.Debug]: 'DEBUG',
  [LogLevel.Info]: 'INFO',
  [LogLevel.Warn]: 'WARN',
  [LogLevel.Error]: 'ERROR',
  [LogLevel.Off]: 'OFF',
};

const MAX_BUFFERED_ENTRIES = 200;

export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly args: readonly unknown[];
}

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') {
    return arg;
  }
  if (arg instanceof Error) {
    return arg.stack ?? arg.message;
  }
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return Object.prototype.toString.call(arg);
  }
}

/**
 * 日志服务：日志点先于落点文件创建时进入有界缓冲，`addLogger` 后按序回放。
 * 落点自身写入失败不会中断业务，收尾交给 onUnexpectedError 且带重入保护。
 */
export class LogService implements ILogService {
  private readonly _loggers: ILogger[] = [];
  private readonly _buffer: LogEntry[] = [];
  private _level: LogLevel = LogLevel.Info;
  private _isDisposed = false;
  private _isReportingLoggerError = false;

  addLogger(logger: ILogger): IDisposable {
    if (this._isDisposed) {
      logger.dispose();
      return toDisposable(() => undefined);
    }
    this._loggers.push(logger);
    for (const entry of this._buffer) {
      this._writeToLoggers(logger, entry);
    }
    this._buffer.length = 0;
    return {
      dispose: () => {
        const index = this._loggers.indexOf(logger);
        if (index >= 0) {
          this._loggers.splice(index, 1);
        }
        logger.dispose();
      },
    };
  }

  getLevel(): LogLevel {
    return this._level;
  }

  setLevel(level: LogLevel): void {
    this._level = level;
  }

  trace(message: string, ...args: unknown[]): void {
    this._log(LogLevel.Trace, message, args);
  }

  debug(message: string, ...args: unknown[]): void {
    this._log(LogLevel.Debug, message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this._log(LogLevel.Info, message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this._log(LogLevel.Warn, message, args);
  }

  error(error: Error | string, ...args: unknown[]): void {
    const message = error instanceof Error ? (error.stack ?? error.message) : error;
    this._log(LogLevel.Error, message, args);
  }

  dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    this._buffer.length = 0;
    for (const logger of [...this._loggers]) {
      logger.dispose();
    }
    this._loggers.length = 0;
  }

  private _log(level: LogLevel, message: string, args: readonly unknown[]): void {
    if (this._isDisposed || level < this._level || level === LogLevel.Off) {
      return;
    }
    const entry: LogEntry = { level, message, args };
    if (this._loggers.length === 0) {
      if (this._buffer.length >= MAX_BUFFERED_ENTRIES) {
        this._buffer.shift();
      }
      this._buffer.push(entry);
      return;
    }
    for (const logger of this._loggers) {
      this._writeToLoggers(logger, entry);
    }
  }

  private _writeToLoggers(logger: ILogger, entry: LogEntry): void {
    try {
      logger.write(entry.level, entry.message, entry.args);
    } catch (error) {
      if (!this._isReportingLoggerError) {
        this._isReportingLoggerError = true;
        try {
          onUnexpectedError(error);
        } finally {
          this._isReportingLoggerError = false;
        }
      }
    }
  }
}

export function formatLogLine(entry: LogEntry): string {
  const args = entry.args.length > 0 ? ` ${entry.args.map(formatArg).join(' ')}` : '';
  return `${LOG_LEVEL_NAMES[entry.level]} ${entry.message}${args}`;
}
