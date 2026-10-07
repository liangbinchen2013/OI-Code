import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EDITOR_SETTINGS,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  normalizeEditorSettings,
} from './editorSettings';

describe('normalizeEditorSettings', () => {
  it('合法输入原样保留', () => {
    expect(normalizeEditorSettings({ fontSize: 18, tabSize: 2 })).toEqual({
      fontSize: 18,
      tabSize: 2,
    });
  });

  it('字号越界被夹取，非法制表符宽度回退默认', () => {
    expect(normalizeEditorSettings({ fontSize: 100, tabSize: 3 })).toEqual({
      fontSize: EDITOR_FONT_SIZE_MAX,
      tabSize: DEFAULT_EDITOR_SETTINGS.tabSize,
    });
    expect(normalizeEditorSettings({ fontSize: 1, tabSize: 8 })).toEqual({
      fontSize: EDITOR_FONT_SIZE_MIN,
      tabSize: 8,
    });
  });

  it('非对象输入回退默认', () => {
    expect(normalizeEditorSettings(undefined)).toEqual(DEFAULT_EDITOR_SETTINGS);
    expect(normalizeEditorSettings('x')).toEqual(DEFAULT_EDITOR_SETTINGS);
  });
});
