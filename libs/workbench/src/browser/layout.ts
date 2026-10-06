import { onUnexpectedError } from '@oi/base';

const SIDEBAR_WIDTH_KEY = 'oi-code.sidebar-width';

export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

/**
 * 读取持久化的侧边栏宽度；缺失或非法时返回默认值。
 */
export function readStoredSidebarWidth(): number {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
  } catch (error) {
    onUnexpectedError(error);
    return SIDEBAR_DEFAULT_WIDTH;
  }
  if (raw === null) {
    return SIDEBAR_DEFAULT_WIDTH;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : SIDEBAR_DEFAULT_WIDTH;
}

export function persistSidebarWidth(width: number): void {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(width)));
  } catch (error) {
    onUnexpectedError(error);
  }
}
