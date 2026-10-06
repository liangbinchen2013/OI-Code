import type { ILanguageContribution } from './language';

/**
 * 首发内置语言：id 与 Monaco 内置 languageId 一致，离线高亮零下载。
 */
export const BUILTIN_LANGUAGES: readonly ILanguageContribution[] = [
  { id: 'cpp', displayName: 'C++', extensions: ['cpp', 'cc', 'cxx', 'h', 'hpp'] },
  { id: 'python', displayName: 'Python', extensions: ['py'] },
  { id: 'markdown', displayName: 'Markdown', extensions: ['md', 'markdown'] },
];
