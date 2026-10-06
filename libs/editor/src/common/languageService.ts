import { type IDisposable, toDisposable } from '@oi/base';
import type { ILanguageContribution, ILanguageService, LanguageId } from './language';

/**
 * 把扩展名规范化为不带点的小写形式。
 */
export function normalizeExtension(extension: string): string {
  const trimmed = extension.startsWith('.') ? extension.slice(1) : extension;
  return trimmed.toLowerCase();
}

/**
 * 从文件路径提取小写扩展名（不含点）；隐藏文件或无扩展名返回 undefined。
 */
export function getFileExtension(path: string): string | undefined {
  const fileName = path.split(/[\\/]/).pop() ?? '';
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return undefined;
  }
  return fileName.slice(dotIndex + 1).toLowerCase();
}

/**
 * 语言注册服务：维护 语言 id 与扩展名 的双向映射。
 * 重复注册（同 id 或同扩展名）立即抛错，避免扩展静默覆盖彼此的声明。
 */
export class LanguageService implements ILanguageService {
  private readonly _byId = new Map<LanguageId, ILanguageContribution>();
  private readonly _byExtension = new Map<string, LanguageId>();

  registerLanguage(contribution: ILanguageContribution): IDisposable {
    if (contribution.id.length === 0) {
      throw new Error('语言 id 不能为空');
    }
    if (this._byId.has(contribution.id)) {
      throw new Error(`语言已注册：${contribution.id}`);
    }
    const extensions = contribution.extensions.map(normalizeExtension);
    for (const extension of extensions) {
      if (extension.length === 0) {
        throw new Error(`语言 ${contribution.id} 存在空扩展名`);
      }
      const owner = this._byExtension.get(extension);
      if (owner !== undefined) {
        throw new Error(`扩展名 .${extension} 已属于语言：${owner}`);
      }
    }
    this._byId.set(contribution.id, contribution);
    for (const extension of extensions) {
      this._byExtension.set(extension, contribution.id);
    }
    return toDisposable(() => this._unregister(contribution.id));
  }

  getLanguageByExtension(extension: string): LanguageId | undefined {
    return this._byExtension.get(normalizeExtension(extension));
  }

  private _unregister(id: LanguageId): void {
    const contribution = this._byId.get(id);
    if (!contribution) {
      return;
    }
    this._byId.delete(id);
    for (const extension of contribution.extensions.map(normalizeExtension)) {
      if (this._byExtension.get(extension) === id) {
        this._byExtension.delete(extension);
      }
    }
  }
}
