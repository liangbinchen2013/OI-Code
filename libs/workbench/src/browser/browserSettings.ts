import { onUnexpectedError } from '@oi/base';

const BROWSER_THEME_KEY = 'oi-code.browser-theme';
const BROWSER_URL_KEY = 'oi-code.browser-last-url';

/** 内置浏览器首页：洛谷（OI 刷题常用）。 */
export const BROWSER_DEFAULT_HOME = 'https://www.luogu.com.cn/';

export type BrowserTheme = 'system' | 'light' | 'dark';

const THEMES: ReadonlySet<BrowserTheme> = new Set(['system', 'light', 'dark']);

export function normalizeBrowserTheme(value: unknown): BrowserTheme {
  return typeof value === 'string' && THEMES.has(value as BrowserTheme)
    ? (value as BrowserTheme)
    : 'system';
}

/**
 * 补全用户输入的网址：缺省协议时补 https；空输入回到首页。
 */
export function normalizeBrowserUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return BROWSER_DEFAULT_HOME;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

/** 仅 http/https 页面可跨会话恢复，避免记住临时页面。 */
export function isPersistableBrowserUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function readStoredBrowserTheme(): BrowserTheme {
  try {
    return normalizeBrowserTheme(window.localStorage.getItem(BROWSER_THEME_KEY));
  } catch (error) {
    onUnexpectedError(error);
    return 'system';
  }
}

export function persistBrowserTheme(theme: BrowserTheme): void {
  try {
    window.localStorage.setItem(BROWSER_THEME_KEY, theme);
  } catch (error) {
    onUnexpectedError(error);
  }
}

export function readStoredBrowserUrl(): string {
  try {
    const stored = window.localStorage.getItem(BROWSER_URL_KEY);
    return stored !== null && isPersistableBrowserUrl(stored) ? stored : BROWSER_DEFAULT_HOME;
  } catch (error) {
    onUnexpectedError(error);
    return BROWSER_DEFAULT_HOME;
  }
}

export function persistBrowserUrl(url: string): void {
  if (!isPersistableBrowserUrl(url)) {
    return;
  }
  try {
    window.localStorage.setItem(BROWSER_URL_KEY, url);
  } catch (error) {
    onUnexpectedError(error);
  }
}
