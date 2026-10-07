import { describe, expect, it } from 'vitest';
import {
  BROWSER_DEFAULT_HOME,
  isPersistableBrowserUrl,
  normalizeBrowserTheme,
  normalizeBrowserUrl,
} from './browserSettings';

describe('normalizeBrowserUrl', () => {
  it('空输入回到首页', () => {
    expect(normalizeBrowserUrl('')).toBe(BROWSER_DEFAULT_HOME);
    expect(normalizeBrowserUrl('   ')).toBe(BROWSER_DEFAULT_HOME);
  });

  it('缺少协议时补 https', () => {
    expect(normalizeBrowserUrl('www.luogu.com.cn')).toBe('https://www.luogu.com.cn');
    expect(normalizeBrowserUrl('luogu.com.cn/problem/P1001')).toBe(
      'https://luogu.com.cn/problem/P1001',
    );
  });

  it('已有协议时原样保留', () => {
    expect(normalizeBrowserUrl('http://example.com')).toBe('http://example.com');
    expect(normalizeBrowserUrl('about:blank')).toBe('about:blank');
  });
});

describe('normalizeBrowserTheme', () => {
  it('非法主题回退跟随系统', () => {
    expect(normalizeBrowserTheme('dark')).toBe('dark');
    expect(normalizeBrowserTheme('app')).toBe('app');
    expect(normalizeBrowserTheme('blue')).toBe('system');
    expect(normalizeBrowserTheme(null)).toBe('system');
  });
});

describe('isPersistableBrowserUrl', () => {
  it('仅 http/https 可持久化', () => {
    expect(isPersistableBrowserUrl('https://www.luogu.com.cn/')).toBe(true);
    expect(isPersistableBrowserUrl('about:blank')).toBe(false);
    expect(isPersistableBrowserUrl('data:text/html,x')).toBe(false);
  });
});
