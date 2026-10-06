import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LogLevel, type ILogger, LogService } from '../common/log';
import { JsonConfigService } from './configService';

interface ILogEntry {
  readonly level: LogLevel;
  readonly message: string;
}

function createCapturingLogger(entries: ILogEntry[]): ILogger {
  return {
    write: (level, message) => {
      entries.push({ level, message });
    },
    flush: () => Promise.resolve(),
    dispose: () => undefined,
  };
}

describe('JsonConfigService', () => {
  it('读写键值并落盘为 JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oi-config-'));
    const filePath = join(directory, 'config.json');
    try {
      const service = new JsonConfigService(new LogService(), filePath);

      await expect(service.get('cpp.gppPath')).resolves.toBeUndefined();
      await service.set('cpp.gppPath', 'C:/msys64/ucrt64/bin/g++.exe');
      await service.set('cpp.standards', ['c++11', 'c++17']);

      expect(await service.get('cpp.gppPath')).toBe('C:/msys64/ucrt64/bin/g++.exe');
      const persisted: unknown = JSON.parse(await readFile(filePath, 'utf8'));
      expect(persisted).toEqual({
        'cpp.gppPath': 'C:/msys64/ucrt64/bin/g++.exe',
        'cpp.standards': ['c++11', 'c++17'],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('并发写入串行化且保留全部键', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oi-config-'));
    const filePath = join(directory, 'config.json');
    try {
      const service = new JsonConfigService(new LogService(), filePath);

      await Promise.all([service.set('a', 1), service.set('b', 2), service.set('c', 3)]);

      const persisted: unknown = JSON.parse(await readFile(filePath, 'utf8'));
      expect(persisted).toEqual({ a: 1, b: 2, c: 3 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('损坏配置回退为空并告警，不阻塞后续读写', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oi-config-'));
    const filePath = join(directory, 'config.json');
    const entries: ILogEntry[] = [];
    const logService = new LogService();
    logService.setLevel(LogLevel.Warn);
    logService.addLogger(createCapturingLogger(entries));
    try {
      await writeFile(filePath, '{ invalid json', 'utf8');
      const service = new JsonConfigService(logService, filePath);

      await expect(service.get('any')).resolves.toBeUndefined();
      await service.set('any', 'value');
      expect(await service.get('any')).toBe('value');
      expect(entries.some((entry) => entry.message.includes('配置文件读取失败'))).toBe(true);
    } finally {
      logService.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
