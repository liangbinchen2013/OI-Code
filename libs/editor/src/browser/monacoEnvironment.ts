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

export const WORKBENCH_THEME_ID = 'oi-code-light';

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
 * 由工作台设计令牌生成 Monaco 浅色主题；令牌缺失时保持 Monaco 默认色。
 */
export function defineWorkbenchTheme(): void {
  const styles = getComputedStyle(document.documentElement);
  const colors: Record<string, string> = {};
  for (const [colorId, tokenName] of Object.entries(MONACO_COLOR_TOKENS)) {
    const value = normalizeColor(styles.getPropertyValue(tokenName));
    if (value !== undefined) {
      colors[colorId] = value;
    }
  }
  monaco.editor.defineTheme(WORKBENCH_THEME_ID, {
    base: 'vs',
    inherit: true,
    rules: [],
    colors,
  });
}
