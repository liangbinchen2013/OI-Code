import { afterEach, describe, expect, it } from 'vitest';
import { setUnexpectedErrorHandler } from '@oi/base';
import { type ILogger, LogLevel, LogService, formatLogLine } from './log';

afterEach(() => {
  setUnexpectedErrorHandler(undefined);
});

class FakeLogger implements ILogger {
  readonly entries: Array<{ level: LogLevel; message: string; args: readonly unknown[] }> = [];
  flushed = false;
  disposed = false;

  write(level: LogLevel, message: string, args: readonly unknown[]): void {
    this.entries.push({ level, message, args });
  }

  async flush(): Promise<void> {
    this.flushed = true;
  }

  dispose(): void {
    this.disposed = true;
  }
}

describe('LogService', () => {
  it('默认 Info 级别过滤低级别日志', () => {
    const logger = new FakeLogger();
    const service = new LogService();
    service.addLogger(logger);

    service.trace('trace');
    service.debug('debug');
    service.info('info');

    expect(logger.entries.map((entry) => entry.message)).toEqual(['info']);
  });

  it('setLevel 调整过滤级别', () => {
    const logger = new FakeLogger();
    const service = new LogService();
    service.addLogger(logger);
    service.setLevel(LogLevel.Trace);

    service.trace('trace');

    expect(service.getLevel()).toBe(LogLevel.Trace);
    expect(logger.entries).toHaveLength(1);
  });

  it('日志点先于落点创建时进入缓冲并按序回放', () => {
    const service = new LogService();
    service.info('first');
    service.warn('second');
    const logger = new FakeLogger();

    service.addLogger(logger);

    expect(logger.entries.map((entry) => entry.message)).toEqual(['first', 'second']);
  });

  it('移除落点后不再写入该落点', () => {
    const logger = new FakeLogger();
    const service = new LogService();
    const registration = service.addLogger(logger);
    service.info('before');

    registration.dispose();
    service.info('after');

    expect(logger.disposed).toBe(true);
    expect(logger.entries.map((entry) => entry.message)).toEqual(['before']);
  });

  it('落点写入异常交给 onUnexpectedError 且不中断业务', () => {
    const errors: unknown[] = [];
    setUnexpectedErrorHandler((error) => errors.push(error));
    const service = new LogService();
    service.addLogger({
      write: () => {
        throw new Error('write failed');
      },
      flush: async () => undefined,
      dispose: () => undefined,
    });

    service.info('still works');

    expect(errors).toHaveLength(1);
  });

  it('error 记录 Error 的堆栈信息', () => {
    const logger = new FakeLogger();
    const service = new LogService();
    service.addLogger(logger);

    service.error(new Error('boom'));

    expect(logger.entries[0]?.level).toBe(LogLevel.Error);
    expect(logger.entries[0]?.message).toContain('boom');
  });

  it('释放后释放落点并忽略后续日志', () => {
    const logger = new FakeLogger();
    const service = new LogService();
    service.addLogger(logger);

    service.dispose();
    service.info('after');

    expect(logger.disposed).toBe(true);
    expect(logger.entries).toHaveLength(0);
  });
});

describe('formatLogLine', () => {
  it('拼接级别、消息与参数', () => {
    const line = formatLogLine({ level: LogLevel.Warn, message: 'slow', args: [42, { a: 1 }] });

    expect(line).toBe('WARN slow 42 {"a":1}');
  });
});
