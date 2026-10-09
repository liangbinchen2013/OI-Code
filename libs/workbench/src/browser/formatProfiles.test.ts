import { afterEach, describe, expect, it, vi } from 'vitest';
import { setUnexpectedErrorHandler } from '@oi/base';
import { DEFAULT_CPP_STYLE } from '@oi/editor';
import {
  activeStyle,
  addProfile,
  BUILT_IN_PROFILE_ID,
  DEFAULT_FORMAT_PROFILES,
  normalizeFormatProfiles,
  normalizeStyle,
  persistFormatProfiles,
  readFormatProfiles,
  removeProfile,
  setActiveProfile,
  updateProfile,
  type IFormatProfileStore,
} from './formatProfiles';

function stubLocalStorage(initial: Readonly<Record<string, string>> = {}): void {
  const store = new Map<string, string>(Object.entries(initial));
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeStyle', () => {
  it('合法字段保留，非法字段回默认', () => {
    expect(normalizeStyle({ indentWidth: 2, braceNextLine: true, spaceAfterComma: 'x' })).toEqual({
      ...DEFAULT_CPP_STYLE,
      braceNextLine: true,
      indentWidth: 2,
    });
  });

  it('非对象输入回默认风格', () => {
    expect(normalizeStyle(undefined)).toEqual(DEFAULT_CPP_STYLE);
    expect(normalizeStyle('x')).toEqual(DEFAULT_CPP_STYLE);
  });
});

describe('normalizeFormatProfiles', () => {
  it('坏数据回落默认档案', () => {
    expect(normalizeFormatProfiles(undefined)).toEqual(DEFAULT_FORMAT_PROFILES);
    expect(normalizeFormatProfiles({ profiles: [] })).toEqual(DEFAULT_FORMAT_PROFILES);
    expect(normalizeFormatProfiles({ profiles: [{ name: '缺 id' }] })).toEqual(
      DEFAULT_FORMAT_PROFILES,
    );
  });

  it('activeId 指向不存在的档案时切到第一份', () => {
    const normalized = normalizeFormatProfiles({
      activeId: 'missing',
      profiles: [{ id: 'a', name: '甲', style: { indentWidth: 2 } }],
    });

    expect(normalized.activeId).toBe('a');
    expect(activeStyle(normalized).indentWidth).toBe(2);
  });
});

describe('档案增删改', () => {
  const base: IFormatProfileStore = DEFAULT_FORMAT_PROFILES;

  it('新增档案会成为当前档案', () => {
    const next = addProfile(base, '考场风格', { ...DEFAULT_CPP_STYLE, indentWidth: 2 });

    expect(next.profiles).toHaveLength(2);
    expect(next.activeId).toBe(next.profiles[1]?.id);
    expect(activeStyle(next).indentWidth).toBe(2);
  });

  it('重命名与改风格只影响目标档案', () => {
    const added = addProfile(base, '乙', DEFAULT_CPP_STYLE);
    const id = (added.profiles[1] as { id: string }).id;
    const updated = updateProfile(added, id, {
      name: '  考场  ',
      style: { ...DEFAULT_CPP_STYLE, braceNextLine: true },
    });

    expect(updated.profiles[1]?.name).toBe('考场');
    expect(updated.profiles[1]?.style.braceNextLine).toBe(true);
    expect(updated.profiles[0]?.name).toBe('默认风格');
  });

  it('至少保留一份档案，删掉当前档案后自动切换', () => {
    const added = addProfile(base, '乙', DEFAULT_CPP_STYLE);
    const second = added.profiles[1] as { id: string };
    const removed = removeProfile(added, second.id);

    expect(removed.profiles).toHaveLength(1);
    expect(removed.activeId).toBe(BUILT_IN_PROFILE_ID);
    expect(removeProfile(removed, BUILT_IN_PROFILE_ID).profiles).toHaveLength(1);
  });

  it('切换到不存在的档案不生效', () => {
    expect(setActiveProfile(base, 'nope')).toBe(base);
    expect(setActiveProfile(base, BUILT_IN_PROFILE_ID).activeId).toBe(BUILT_IN_PROFILE_ID);
  });
});

describe('持久化', () => {
  it('无存储时返回默认档案', () => {
    stubLocalStorage();

    expect(readFormatProfiles()).toEqual(DEFAULT_FORMAT_PROFILES);
  });

  it('写入后能读回，坏 JSON 回落默认', () => {
    stubLocalStorage();
    const store = addProfile(DEFAULT_FORMAT_PROFILES, '我的风格', {
      ...DEFAULT_CPP_STYLE,
      indentWithTabs: true,
    });
    persistFormatProfiles(store);

    expect(readFormatProfiles()).toEqual(store);

    stubLocalStorage({ 'oi-code.format-profiles': '{坏数据' });
    // 默认错误处理器会把异常再抛出，测试里只关心"回落默认值"这条降级路径
    setUnexpectedErrorHandler(() => undefined);
    try {
      expect(readFormatProfiles()).toEqual(DEFAULT_FORMAT_PROFILES);
    } finally {
      setUnexpectedErrorHandler(undefined);
    }
  });
});
