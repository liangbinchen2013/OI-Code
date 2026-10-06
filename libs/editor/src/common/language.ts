import { type IDisposable } from '@oi/base';
import { createDecorator } from '@oi/platform';

/**
 * 语言标识（如 cpp、python）。
 */
export type LanguageId = string;

/**
 * 语言贡献信息：内置扩展声明语言 id、文件扩展名与显示名。
 */
export interface ILanguageContribution {
  readonly id: LanguageId;
  readonly extensions: readonly string[];
  readonly displayName: string;
}

/**
 * 语言注册服务契约：编辑器据此完成文件到语言的映射。
 */
export interface ILanguageService {
  registerLanguage(contribution: ILanguageContribution): IDisposable;
  getLanguageByExtension(extension: string): LanguageId | undefined;
}

export const ILanguageService = createDecorator<ILanguageService>('languageService');
