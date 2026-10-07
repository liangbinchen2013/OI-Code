import { setUnexpectedErrorHandler } from '@oi/base';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_VJUDGE_SETTINGS,
  normalizeVjudgeCases,
  normalizeVjudgeSettings,
  readVjudgeCases,
  readVjudgeSettings,
  saveVjudgeCases,
} from './vjudgeSettings';

function stubLocalStorage(initial: Record<string, string> = {}): Map<string, string> {
  const store = new Map<string, string>(Object.entries(initial));
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
  });
  return store;
}

describe('normalizeVjudgeSettings', () => {
  it('保留合法开关，非法输入回退默认（默认开启预检）', () => {
    expect(normalizeVjudgeSettings({ preflight: false })).toEqual({ preflight: false });
    expect(normalizeVjudgeSettings({ preflight: 'no' })).toEqual(DEFAULT_VJUDGE_SETTINGS);
    expect(normalizeVjudgeSettings(undefined)).toEqual(DEFAULT_VJUDGE_SETTINGS);
    expect(normalizeVjudgeSettings('x')).toEqual(DEFAULT_VJUDGE_SETTINGS);
  });
});

describe('normalizeVjudgeCases', () => {
  it('丢弃结构非法条目与空题号', () => {
    const normalized = normalizeVjudgeCases({
      'POJ-1182': [
        { name: '样例1', input: '3 3\n', expectedOutput: '2\n' },
        { name: 123, input: 'x' },
        'not-an-object',
      ],
      ' ': [{ input: 'a', expectedOutput: 'b' }],
      'HDU-1001': [],
      broken: 'nope',
    });
    expect(normalized).toEqual({
      'POJ-1182': [{ expectedOutput: '2\n', input: '3 3\n', name: '样例1' }],
    });
  });

  it('缺 name 时补默认名', () => {
    expect(normalizeVjudgeCases({ 'A-1': [{ input: 'i', expectedOutput: 'o' }] })['A-1']).toEqual([
      { expectedOutput: 'o', input: 'i', name: '样例' },
    ]);
  });
});

describe('存储读写', () => {
  const reported: unknown[] = [];

  beforeEach(() => {
    stubLocalStorage();
    // 应用启动时会安装全局错误处理器；测试里同样安装，避免上报被当作未捕获异常
    setUnexpectedErrorHandler((error) => reported.push(error));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setUnexpectedErrorHandler((error) => {
      throw error;
    });
    reported.length = 0;
  });

  it('无记录时返回默认值与空表', () => {
    expect(readVjudgeSettings()).toEqual(DEFAULT_VJUDGE_SETTINGS);
    expect(readVjudgeCases()).toEqual({});
  });

  it('saveVjudgeCases 覆盖并返回最新全量存储', () => {
    const first = saveVjudgeCases('POJ-1182', [{ input: '1', name: 'a', expectedOutput: '2' }]);
    expect(first['POJ-1182']).toHaveLength(1);
    const second = saveVjudgeCases('CF-1', [{ input: '3', name: 'b', expectedOutput: '4' }]);
    expect(Object.keys(second).sort()).toEqual(['CF-1', 'POJ-1182']);
  });

  it('传空数组即移除该题记录', () => {
    saveVjudgeCases('POJ-1182', [{ input: '1', name: 'a', expectedOutput: '2' }]);
    const after = saveVjudgeCases('POJ-1182', []);
    expect(after['POJ-1182']).toBeUndefined();
    expect(readVjudgeCases()['POJ-1182']).toBeUndefined();
  });

  it('损坏的存储内容不会抛出，回退默认', () => {
    stubLocalStorage({ 'oi-code.vjudge-settings': '{坏数据', 'oi-code.vjudge-cases': '[1,2]' });
    expect(readVjudgeSettings()).toEqual(DEFAULT_VJUDGE_SETTINGS);
    expect(readVjudgeCases()).toEqual({});
    expect(reported.length).toBeGreaterThan(0);
  });
});
