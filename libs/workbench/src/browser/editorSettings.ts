import { onUnexpectedError } from '@oi/base';

const EDITOR_SETTINGS_KEY = 'oi-code.editor-settings';

export const EDITOR_FONT_SIZE_MIN = 12;
export const EDITOR_FONT_SIZE_MAX = 24;
export const EDITOR_TAB_SIZE_OPTIONS: readonly number[] = [2, 4, 8];

export interface IEditorSettings {
  readonly fontSize: number;
  readonly tabSize: number;
}

export const DEFAULT_EDITOR_SETTINGS: IEditorSettings = { fontSize: 14, tabSize: 4 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * 校验并归位外部输入；非法字段回退默认值。
 */
export function normalizeEditorSettings(value: unknown): IEditorSettings {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_EDITOR_SETTINGS;
  }
  const { fontSize, tabSize } = value as { fontSize?: unknown; tabSize?: unknown };
  const normalizedFontSize =
    typeof fontSize === 'number' && Number.isFinite(fontSize)
      ? clamp(fontSize, EDITOR_FONT_SIZE_MIN, EDITOR_FONT_SIZE_MAX)
      : DEFAULT_EDITOR_SETTINGS.fontSize;
  const normalizedTabSize =
    typeof tabSize === 'number' && EDITOR_TAB_SIZE_OPTIONS.includes(tabSize)
      ? tabSize
      : DEFAULT_EDITOR_SETTINGS.tabSize;
  return { fontSize: normalizedFontSize, tabSize: normalizedTabSize };
}

export function readEditorSettings(): IEditorSettings {
  try {
    const raw = window.localStorage.getItem(EDITOR_SETTINGS_KEY);
    if (raw === null) {
      return DEFAULT_EDITOR_SETTINGS;
    }
    return normalizeEditorSettings(JSON.parse(raw));
  } catch (error) {
    onUnexpectedError(error);
    return DEFAULT_EDITOR_SETTINGS;
  }
}

export function persistEditorSettings(settings: IEditorSettings): void {
  try {
    window.localStorage.setItem(EDITOR_SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    onUnexpectedError(error);
  }
}
