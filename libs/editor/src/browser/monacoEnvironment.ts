/// <reference types="vite/client" />
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/features/register.all.js';
// 注册全部内置语言定义：任意文件都尽量匹配高亮（语法文件按需懒加载）
import 'monaco-editor/languages/register.all.js';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker&inline';

let environmentReady = false;

/**
 * 注册 Monaco worker。inline 形式避免 file:// 生产环境的跨源加载问题，
 * 对应生产 CSP 的 `worker-src blob:`。
 */
export function ensureMonacoEnvironment(): void {
  if (environmentReady) {
    return;
  }
  self.MonacoEnvironment = {
    getWorker: () => new EditorWorker(),
  };
  environmentReady = true;
}

/**
 * 工作台主题种类；浅色 / 暗色各自对应一个 Monaco 主题 id。
 */
export type ThemeKind = 'light' | 'dark';

const THEME_IDS: Record<ThemeKind, string> = {
  light: 'oi-code-light',
  dark: 'oi-code-dark',
};

export function themeIdFor(kind: ThemeKind): string {
  return THEME_IDS[kind];
}

/**
 * 读取 DOM 上当前的主题种类，供编辑器创建时选择主题。
 */
export function currentThemeKind(): ThemeKind {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * Monaco 配色 → 工作台设计令牌映射（UI_DESIGN.md §2）。
 */
const MONACO_COLOR_TOKENS: Readonly<Record<string, string>> = {
  'editor.background': '--bg',
  'editor.foreground': '--text',
  'editor.lineHighlightBackground': '--code-bg',
  'editorLineNumber.foreground': '--muted',
  'editorLineNumber.activeForeground': '--link',
  'editorCursor.foreground': '--link',
  'editor.selectionBackground': '--heat-l1',
  'editorIndentGuide.background1': '--border',
  'editorIndentGuide.activeBackground1': '--border',
  'editorWidget.border': '--border',
  'editorSuggestWidget.background': '--card-bg',
  'editorSuggestWidget.selectedBackground': '--btn-hover',
  'scrollbarSlider.background': '--glow-ring',
  'scrollbarSlider.hoverBackground': '--glow-ring',
  'scrollbarSlider.activeBackground': '--glow-ring',
};

const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;

/**
 * Monaco 的主题颜色只接受 6/8 位十六进制；
 * Chromium 会把 #ffffff 规范化为 #fff，这里展开还原。
 */
function normalizeColor(value: string): string | undefined {
  const color = value.trim();
  if (color.length === 0) {
    return undefined;
  }
  const match = HEX_SHORT.exec(color);
  if (match) {
    const r = match[1] ?? '';
    const g = match[2] ?? '';
    const b = match[3] ?? '';
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return color;
}

/**
 * 由工作台设计令牌生成 Monaco 主题并全局应用。
 * 调用方需先设置 `document.documentElement.dataset.theme`，颜色从计算样式读取。
 */
export function applyWorkbenchTheme(kind: ThemeKind): void {
  const styles = getComputedStyle(document.documentElement);
  const colors: Record<string, string> = {};
  for (const [colorId, tokenName] of Object.entries(MONACO_COLOR_TOKENS)) {
    const value = normalizeColor(styles.getPropertyValue(tokenName));
    if (value !== undefined) {
      colors[colorId] = value;
    }
  }
  monaco.editor.defineTheme(THEME_IDS[kind], {
    base: kind === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors,
  });
  monaco.editor.setTheme(THEME_IDS[kind]);
}
