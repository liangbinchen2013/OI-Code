import { onUnexpectedError } from '@oi/base';

const SIDEBAR_WIDTH_KEY = 'oi-code.sidebar-width';
const SIDEBAR_LAST_EXPANDED_KEY = 'oi-code.sidebar-last-expanded-width';
const SPLIT_KEY = 'oi-code.split';

export const SIDEBAR_DEFAULT_WIDTH = 260;
/** 折叠态宽度：仅保留活动栏图标列。 */
export const SIDEBAR_COLLAPSED_WIDTH = 48;
/** 编辑器保留的最小宽度，限制侧边栏拖拽上限。 */
export const EDITOR_MIN_WIDTH = 360;
/** 拖拽结束低于该宽度时吸附到完全折叠。 */
export const SIDEBAR_COLLAPSE_SNAP = 60;

/** 当前窗口宽度下侧边栏可占据的最大宽度。 */
export function sidebarMaxWidth(windowWidth: number): number {
  return Math.max(SIDEBAR_COLLAPSED_WIDTH, Math.round(windowWidth - EDITOR_MIN_WIDTH));
}

/**
 * 夹取侧边栏宽度：下限为折叠宽度，上限随窗口宽度动态变化。
 */
export function clampSidebarWidth(width: number, windowWidth = window.innerWidth): number {
  return Math.min(
    sidebarMaxWidth(windowWidth),
    Math.max(SIDEBAR_COLLAPSED_WIDTH, Math.round(width)),
  );
}

export function isCollapsedWidth(width: number): boolean {
  return width <= SIDEBAR_COLLAPSED_WIDTH;
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

/**
 * 读取上次非折叠宽度；记录缺失、过窄或折叠态时回退到默认宽度。
 */
export function readStoredLastExpandedWidth(): number {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SIDEBAR_LAST_EXPANDED_KEY);
  } catch (error) {
    onUnexpectedError(error);
    return SIDEBAR_DEFAULT_WIDTH;
  }
  if (raw === null) {
    return SIDEBAR_DEFAULT_WIDTH;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < SIDEBAR_COLLAPSE_SNAP) {
    return SIDEBAR_DEFAULT_WIDTH;
  }
  return clampSidebarWidth(parsed);
}

/**
 * 持久化侧边栏宽度；展开态同时记录为“上次非折叠宽度”。
 */
export function persistSidebarWidth(width: number): void {
  const clamped = clampSidebarWidth(width);
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped));
    if (!isCollapsedWidth(clamped)) {
      window.localStorage.setItem(SIDEBAR_LAST_EXPANDED_KEY, String(clamped));
    }
  } catch (error) {
    onUnexpectedError(error);
  }
}

/** 分屏方向：左右（horizontal）或上下（vertical）。 */
export type SplitDirection = 'horizontal' | 'vertical';

export const SPLIT_DEFAULT_RATIO = 0.5;
export const SPLIT_RATIO_MIN = 0.2;
export const SPLIT_RATIO_MAX = 0.8;

export interface ISplitState {
  readonly direction: SplitDirection | null;
  readonly ratio: number;
}

export function clampSplitRatio(ratio: number): number {
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, ratio));
}

/**
 * 读取持久化的分屏状态；缺失或非法时关闭分屏并恢复默认比例。
 */
export function readStoredSplit(): ISplitState {
  const fallback: ISplitState = { direction: null, ratio: SPLIT_DEFAULT_RATIO };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SPLIT_KEY);
  } catch (error) {
    onUnexpectedError(error);
    return fallback;
  }
  if (raw === null) {
    return fallback;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return fallback;
  }
  const { direction, ratio } = parsed as { direction?: unknown; ratio?: unknown };
  return {
    direction: direction === 'horizontal' || direction === 'vertical' ? direction : null,
    ratio:
      typeof ratio === 'number' && Number.isFinite(ratio)
        ? clampSplitRatio(ratio)
        : SPLIT_DEFAULT_RATIO,
  };
}

export function persistSplit(state: ISplitState): void {
  try {
    window.localStorage.setItem(
      SPLIT_KEY,
      JSON.stringify({ direction: state.direction, ratio: clampSplitRatio(state.ratio) }),
    );
  } catch (error) {
    onUnexpectedError(error);
  }
}
