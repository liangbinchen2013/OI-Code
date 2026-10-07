import * as monaco from 'monaco-editor/editor/editor.api';

/**
 * 使用 Monaco 词法分析为代码片段着色，返回可注入的 HTML 片段。
 * 供 Markdown 预览等场景复用编辑器高亮能力。
 */
export async function colorizeCode(code: string, languageId: string): Promise<string> {
  return monaco.editor.colorize(code, languageId, { tabSize: 4 });
}
