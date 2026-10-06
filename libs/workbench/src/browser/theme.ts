import { onUnexpectedError } from '@oi/base';
import { applyWorkbenchTheme, type ThemeKind } from '@oi/editor/browser';

const THEME_STORAGE_KEY = 'oi-code.theme';

/**
 * 读取用户显式选择的主题；未选择过返回 undefined（此时跟随系统）。
 */
export function readStoredTheme(): ThemeKind | undefined {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : undefined;
  } catch (error) {
    onUnexpectedError(error);
    return undefined;
  }
}

/**
 * 初始主题：用户选择优先，否则跟随系统（prefers-color-scheme）。
 */
export function resolveInitialTheme(): ThemeKind {
  const stored = readStoredTheme();
  if (stored !== undefined) {
    return stored;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * 应用主题：先落到 DOM 令牌，再让 Monaco 依据令牌重算主题。
 */
export function applyTheme(theme: ThemeKind): void {
  document.documentElement.dataset.theme = theme;
  applyWorkbenchTheme(theme);
}

export function persistTheme(theme: ThemeKind): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    onUnexpectedError(error);
  }
}
