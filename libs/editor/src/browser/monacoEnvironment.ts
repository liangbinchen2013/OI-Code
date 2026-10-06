import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker&inline';

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

/**
 * 由工作台设计令牌生成 Monaco 浅色主题；令牌缺失时保持 Monaco 默认色。
 */
export function defineWorkbenchTheme(): void {
  const styles = getComputedStyle(document.documentElement);
  const colors: Record<string, string> = {};
  for (const [colorId, tokenName] of Object.entries(MONACO_COLOR_TOKENS)) {
    const value = styles.getPropertyValue(tokenName).trim();
    if (value.length > 0) {
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
