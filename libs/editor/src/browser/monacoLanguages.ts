import * as monaco from 'monaco-editor/editor/editor.api';
import type { ILanguageContribution } from '../common/language';

/**
 * 导出 Monaco 已注册的全部语言贡献（扩展名 / 文件名 / 显示名）。
 * 启动时灌入 ILanguageService，保证任意文件都尽量匹配到高亮。
 */
export function collectMonacoLanguageContributions(): ILanguageContribution[] {
  return monaco.languages.getLanguages().map((language) => ({
    id: language.id,
    displayName: language.aliases?.[0] ?? language.id,
    extensions: (language.extensions ?? []).map((extension) => extension.replace(/^\./, '')),
    ...(language.filenames === undefined ? {} : { filenames: language.filenames }),
  }));
}
