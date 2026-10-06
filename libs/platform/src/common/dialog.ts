import type { URI } from '@oi/base';
import { createDecorator } from './instantiation';

/**
 * 打开文件对话框的过滤条件，扩展名不带点前缀。
 */
export interface IFileDialogFilter {
  readonly name: string;
  readonly extensions: readonly string[];
}

export interface IOpenFileDialogOptions {
  readonly title?: string;
  readonly filters?: readonly IFileDialogFilter[];
}

/**
 * 原生对话框契约：实现位于 Code 层（Electron），扩展与工作台只依赖此接口。
 */
export interface IFileDialogService {
  /** 弹出系统打开文件对话框；用户取消时返回 undefined。 */
  showOpenFile(options?: IOpenFileDialogOptions): Promise<URI | undefined>;
  /** 询问用户是否放弃未保存的修改；确认放弃返回 true。 */
  confirmDiscardChanges(fileName?: string): Promise<boolean>;
}

export const IFileDialogService = createDecorator<IFileDialogService>('fileDialogService');
