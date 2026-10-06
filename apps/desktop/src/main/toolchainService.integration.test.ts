import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { URI } from '@oi/base';
import { LogService, type IConfigService, type IRunnerService } from '@oi/platform';
import { ToolchainService, executablePathFor } from './toolchainService';

function hasGpp(): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['g++'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

class MemoryConfigService implements IConfigService {
  private readonly _values = new Map<string, unknown>();

  get(key: string): Promise<unknown> {
    return Promise.resolve(this._values.get(key));
  }

  set(key: string, value: unknown): Promise<void> {
    this._values.set(key, value);
    return Promise.resolve();
  }
}

const runnerStub: IRunnerService = {
  run: () => Promise.resolve({ launched: false }),
};

describe.skipIf(!hasGpp())('ToolchainService（真实 g++ 集成）', () => {
  it('搜索到编译器并探测出标准列表', async () => {
    const service = new ToolchainService(new LogService(), new MemoryConfigService(), runnerStub);

    const status = await service.search();

    expect(status.found).toBe(true);
    expect(status.compilerPath).toBeDefined();
    expect(status.supportedStandards).toContain('c++11');
    expect(status.supportedStandards).toContain('c++17');
    expect(status.supportedStandards).toContain('c++20');
    expect(status.defaultStandard).toBe(
      status.supportedStandards[status.supportedStandards.length - 1],
    );
  }, 60_000);

  it('编译成功产出同目录可执行文件，失败时诊断映射回原文件', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oi-toolchain-'));
    const service = new ToolchainService(new LogService(), new MemoryConfigService(), runnerStub);
    try {
      await service.search();
      const goodPath = join(directory, 'Good.cpp');
      await writeFile(goodPath, '#include <cstdio>\nint main() { printf("ok"); return 0; }\n');
      const goodUri = URI.file(goodPath);
      const goodResult = await service.compile({
        uri: goodUri,
        content: await readFile(goodPath, 'utf8'),
      });

      expect(goodResult.ok).toBe(true);
      expect(goodResult.diagnostics).toEqual([]);
      expect(existsSync(executablePathFor(goodPath))).toBe(true);

      const badPath = join(directory, 'Bad.cpp');
      const badSource = 'int main() {\n  int value = ;\n  return 0;\n}\n';
      await writeFile(badPath, badSource);
      const badUri = URI.file(badPath);
      const badResult = await service.compile({ uri: badUri, content: badSource });

      expect(badResult.ok).toBe(false);
      const first = badResult.diagnostics[0];
      expect(first?.severity).toBe('error');
      expect(first?.line).toBe(2);
      expect(first?.fileName).toBe('Bad.cpp');
      expect(first?.uri?.fsPath).toBe(badUri.fsPath);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('实时检查对错误源文件给出诊断，对正确源文件返回空', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oi-check-'));
    const service = new ToolchainService(new LogService(), new MemoryConfigService(), runnerStub);
    try {
      await service.search();
      const uri = URI.file(join(directory, 'Check.cpp'));

      const bad = await service.check(uri, 'int main() { int x = ; }\n');
      expect(bad.length).toBeGreaterThan(0);
      expect(bad[0]?.uri?.fsPath).toBe(uri.fsPath);

      const good = await service.check(uri, 'int main() { return 0; }\n');
      expect(good).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
