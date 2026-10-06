import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  executablePathFor,
  generateStandardCandidates,
  parseCompileFlags,
  parseGppVersion,
} from './toolchainService';

describe('parseCompileFlags', () => {
  it('按空白切分并保留引号内片段', () => {
    expect(parseCompileFlags('-std=c++11 -Wall -O2')).toEqual(['-std=c++11', '-Wall', '-O2']);
    expect(parseCompileFlags('  -I "C:/my includes" -DFOO=\'a b\'  ')).toEqual([
      '-I',
      'C:/my includes',
      '-DFOO=a b',
    ]);
  });

  it('空串与纯空白返回空列表', () => {
    expect(parseCompileFlags('')).toEqual([]);
    expect(parseCompileFlags('   \t ')).toEqual([]);
  });
});

describe('generateStandardCandidates', () => {
  it('包含历史标准并按年份递增延伸到未来', () => {
    const candidates = generateStandardCandidates();

    expect(candidates[0]).toBe('c++98');
    expect(candidates).toContain('c++11');
    expect(candidates).toContain('c++20');
    expect(candidates).toContain('c++23');
    expect(candidates).toContain('c++26');
    expect(candidates.indexOf('c++26')).toBeGreaterThan(candidates.indexOf('c++23'));
    expect(candidates[candidates.length - 1]).toBe('c++53');
  });
});

describe('parseGppVersion', () => {
  it('解析 MSYS2 与 GCC 两种版本行', () => {
    expect(parseGppVersion('g++ (Rev5, Built by MSYS2 project) 16.1.0\nCopyright...')).toBe(
      '16.1.0',
    );
    expect(parseGppVersion('g++ (GCC) 13.2')).toBe('13.2');
  });

  it('无法识别时返回 undefined', () => {
    expect(parseGppVersion('not a compiler')).toBeUndefined();
  });
});

describe('compareVersions', () => {
  it('按数字段比较', () => {
    expect(compareVersions('16.1.0', '13.2.0')).toBeGreaterThan(0);
    expect(compareVersions('13.2', '13.2.0')).toBe(0);
    expect(compareVersions('9.5.0', '13.2.0')).toBeLessThan(0);
  });
});

describe('executablePathFor', () => {
  it('Windows 下生成同名 .exe', () => {
    const result = executablePathFor('C:/problems/T1.cpp');

    if (process.platform === 'win32') {
      expect(result).toBe('C:/problems/T1.exe');
    } else {
      expect(result).toBe('C:/problems/T1');
    }
  });
});
