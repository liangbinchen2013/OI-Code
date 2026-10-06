import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IConfigService } from '@oi/platform';
import { LogLevel, LogService, type ILogger } from '@oi/platform';
import { CONFIG_KEYS } from './configKeys';
import { OI_RUNNER_SOURCE } from './oiRunnerSource';
import { OI_RUNNER_EXE_NAME, RunnerService, withPrependedPath } from './runnerService';

class MemoryConfigService implements IConfigService {
  private readonly _values = new Map<string, unknown>();

  constructor(initial: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(initial)) {
      this._values.set(key, value);
    }
  }

  get(key: string): Promise<unknown> {
    return Promise.resolve(this._values.get(key));
  }

  set(key: string, value: unknown): Promise<void> {
    this._values.set(key, value);
    return Promise.resolve();
  }
}

function createLogCapture(): { service: LogService; messages: string[] } {
  const messages: string[] = [];
  const logger: ILogger = {
    write: (level, message) => {
      if (level >= LogLevel.Warn) {
        messages.push(message);
      }
    },
    flush: () => Promise.resolve(),
    dispose: () => undefined,
  };
  const service = new LogService();
  service.setLevel(LogLevel.Warn);
  service.addLogger(logger);
  return { service, messages };
}

describe('withPrependedPath', () => {
  it('保留原 Path 大小写并前置目录', () => {
    const environment = withPrependedPath({ Path: 'C:/base', HOME: 'x' }, ['C:/gpp'], ';');

    expect(environment['Path']).toBe('C:/gpp;C:/base');
    expect(environment['HOME']).toBe('x');
  });

  it('无 PATH 时新建 PATH，空前置时原样返回', () => {
    expect(withPrependedPath({}, ['C:/gpp'], ';')['PATH']).toBe('C:/gpp');
    expect(withPrependedPath({ Path: 'C:/base' }, [], ';')['Path']).toBe('C:/base');
  });
});

describe('RunnerService.ensureRunner', () => {
  it('源码哈希匹配且 exe 存在时直接复用缓存', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oi-runner-'));
    const runnerDirectory = join(directory, 'runner');
    const { service: logService } = createLogCapture();
    try {
      await mkdir(runnerDirectory, { recursive: true });
      await writeFile(join(runnerDirectory, OI_RUNNER_EXE_NAME), 'stub', 'utf8');
      const sourceHash = createHash('sha256').update(OI_RUNNER_SOURCE).digest('hex');
      const config = new MemoryConfigService({
        [CONFIG_KEYS.runnerHash]: sourceHash,
        [CONFIG_KEYS.gppPath]: 'C:/missing/g++.exe',
      });
      const runner = new RunnerService(logService, config, runnerDirectory);

      await expect(runner.ensureRunner()).resolves.toBe(join(runnerDirectory, OI_RUNNER_EXE_NAME));
    } finally {
      logService.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('未配置 g++ 时返回 undefined 并告警', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oi-runner-'));
    const { service: logService, messages } = createLogCapture();
    try {
      const runner = new RunnerService(
        logService,
        new MemoryConfigService(),
        join(directory, 'runner'),
      );

      await expect(runner.ensureRunner()).resolves.toBeUndefined();
      expect(messages.some((message) => message.includes('未找到 g++'))).toBe(true);
    } finally {
      logService.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('g++ 路径无效时编译失败返回 undefined 并记录日志', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oi-runner-'));
    const { service: logService, messages } = createLogCapture();
    try {
      const fakeGpp = join(directory, 'fake-g++.exe');
      await writeFile(fakeGpp, 'not executable body', 'utf8');
      const config = new MemoryConfigService({ [CONFIG_KEYS.gppPath]: fakeGpp });
      const runner = new RunnerService(logService, config, join(directory, 'runner'));

      await expect(runner.ensureRunner()).resolves.toBeUndefined();
      expect(messages.some((message) => message.includes('OI 运行器'))).toBe(true);
    } finally {
      logService.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
