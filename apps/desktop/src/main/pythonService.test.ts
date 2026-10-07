import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { URI } from '@oi/base';
import { LogService, type IConfigService, type IRunnerService } from '@oi/platform';
import {
  PythonService,
  TSINGHUA_PYPI_INDEX,
  buildPipArguments,
  mergeInterpreters,
  parsePyLauncherOutput,
  parseSyntaxCheckOutput,
  validatePackageSpec,
} from './pythonService';

function hasPython(): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['python'], {
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

describe('mergeInterpreters', () => {
  it('按路径去重并保持版本降序，新探测结果覆盖旧条目', () => {
    const merged = mergeInterpreters(
      [
        { path: 'C:\\Python311\\python.exe', version: '3.11.9', versionText: 'Python 3.11.9' },
        { path: 'C:\\msys64\\python.exe', version: '3.12.0', versionText: 'Python 3.12.0' },
      ],
      [
        { path: 'c:/PYTHON311/python.exe', version: '3.11.9', versionText: 'Python 3.11.9' },
        { path: 'C:\\Python313\\python.exe', version: '3.13.1', versionText: 'Python 3.13.1' },
      ],
    );

    expect(merged.map((interpreter) => interpreter.version)).toEqual([
      '3.13.1',
      '3.12.0',
      '3.11.9',
    ]);
    expect(merged).toHaveLength(3);
  });
});

describe('parsePyLauncherOutput', () => {
  it('提取含空格的解释器路径', () => {
    const output = [
      ' -V:3.13 *        C:\\Users\\OI\\AppData\\Local\\Programs\\Python\\Python313\\python.exe',
      ' -V:3.11          C:\\Program Files\\Python311\\python.exe',
      ' -V:3.9           C:\\Python39\\python.exe',
    ].join('\r\n');

    expect(parsePyLauncherOutput(output)).toEqual([
      'C:\\Users\\OI\\AppData\\Local\\Programs\\Python\\Python313\\python.exe',
      'C:\\Program Files\\Python311\\python.exe',
      'C:\\Python39\\python.exe',
    ]);
  });
});

describe('validatePackageSpec', () => {
  it('接受合法包名与版本', () => {
    expect(validatePackageSpec({ packageName: 'numpy', useTsinghuaMirror: true })).toBeUndefined();
    expect(
      validatePackageSpec({
        packageName: 'scikit-learn',
        version: '1.5.0',
        useTsinghuaMirror: false,
      }),
    ).toBeUndefined();
  });

  it('拒绝非法包名与版本', () => {
    expect(validatePackageSpec({ packageName: '-bad', useTsinghuaMirror: true })).toBeDefined();
    expect(validatePackageSpec({ packageName: '包', useTsinghuaMirror: true })).toBeDefined();
    expect(
      validatePackageSpec({ packageName: 'numpy', version: '; rm', useTsinghuaMirror: true }),
    ).toBeDefined();
  });
});

describe('buildPipArguments', () => {
  it('带版本与清华源时生成完整参数', () => {
    const args = buildPipArguments('C:/Python313/python.exe', {
      packageName: 'numpy',
      version: '2.1.0',
      useTsinghuaMirror: true,
    });

    expect(args).toEqual([
      'C:/Python313/python.exe',
      '-m',
      'pip',
      'install',
      'numpy==2.1.0',
      '--disable-pip-version-check',
      '--no-input',
      '-i',
      TSINGHUA_PYPI_INDEX,
    ]);
  });

  it('不带版本与镜像时省略对应参数', () => {
    const args = buildPipArguments('C:/Python313/python.exe', {
      packageName: 'numpy',
      useTsinghuaMirror: false,
    });

    expect(args).not.toContain('-i');
    expect(args).toContain('numpy');
  });
});

describe('parseSyntaxCheckOutput', () => {
  it('解析 JSON 载荷，空输出表示通过', () => {
    const payload = parseSyntaxCheckOutput(
      '{"line": 2, "column": 8, "endLine": 2, "endColumn": 9, "message": "invalid syntax"}',
    );

    expect(payload).toMatchObject({ line: 2, column: 8, message: 'invalid syntax' });
    expect(parseSyntaxCheckOutput('')).toBeUndefined();
    expect(parseSyntaxCheckOutput('not json')).toBeUndefined();
  });
});

describe.skipIf(!hasPython())('PythonService（真实解释器集成）', () => {
  it('搜索到解释器并默认选用最高版本', async () => {
    const service = new PythonService(new LogService(), new MemoryConfigService(), runnerStub);

    const status = await service.search();

    expect(status.interpreters.length).toBeGreaterThan(0);
    expect(status.defaultPath).toBe(status.interpreters[0]?.path);
  }, 60_000);

  it('语法检查返回行列与原因，正确代码无诊断', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oi-python-'));
    const service = new PythonService(new LogService(), new MemoryConfigService(), runnerStub);
    try {
      await service.search();
      const uri = URI.file(join(directory, 'T1.py'));

      const diagnostics = await service.check(uri, 'def solve(:\n    pass\n');
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.line).toBe(1);
      expect(diagnostics[0]?.fileName).toBe('T1.py');

      await expect(service.check(uri, 'def solve():\n    return 0\n')).resolves.toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
