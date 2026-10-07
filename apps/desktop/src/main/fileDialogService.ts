import {
  BrowserWindow,
  dialog,
  type MessageBoxOptions,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';
import { URI } from '@oi/base';
import type {
  IFileDialogService,
  IOpenFileDialogOptions,
  ISaveFileDialogOptions,
} from '@oi/platform';

/**
 * 恢复主窗口与 webContents 焦点。
 * Windows 上原生对话框关闭后偶尔不归还焦点，导致编辑器光标消失或无法输入。
 */
function restoreWindowFocus(window: BrowserWindow | undefined): void {
  if (window === undefined || window.isDestroyed()) {
    return;
  }
  window.focus();
  window.webContents.focus();
}

/**
 * Electron 原生对话框实现（Code 层装配）：对话框是获得文件访问授权的唯一入口。
 */
export class FileDialogService implements IFileDialogService {
  async showOpenFile(options?: IOpenFileDialogOptions): Promise<URI | undefined> {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const dialogOptions: OpenDialogOptions = {
      ...(options?.title === undefined ? {} : { title: options.title }),
      filters: (options?.filters ?? []).map((filter) => ({
        name: filter.name,
        extensions: [...filter.extensions],
      })),
      properties: ['openFile'],
    };
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    restoreWindowFocus(window);
    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }
    const selected = result.filePaths[0];
    return selected === undefined ? undefined : URI.file(selected);
  }

  async showOpenFolder(options?: IOpenFileDialogOptions): Promise<URI | undefined> {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const dialogOptions: OpenDialogOptions = {
      ...(options?.title === undefined ? {} : { title: options.title }),
      properties: ['openDirectory'],
    };
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    restoreWindowFocus(window);
    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }
    const selected = result.filePaths[0];
    return selected === undefined ? undefined : URI.file(selected);
  }

  async showSaveFile(options?: ISaveFileDialogOptions): Promise<URI | undefined> {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const dialogOptions: SaveDialogOptions = {
      ...(options?.title === undefined ? {} : { title: options.title }),
      ...(options?.defaultPath === undefined ? {} : { defaultPath: options.defaultPath }),
    };
    const result = window
      ? await dialog.showSaveDialog(window, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);
    restoreWindowFocus(window);
    if (result.canceled || result.filePath === undefined || result.filePath.length === 0) {
      return undefined;
    }
    return URI.file(result.filePath);
  }

  async confirmDiscardChanges(fileName?: string): Promise<boolean> {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options: MessageBoxOptions = {
      type: 'warning',
      buttons: ['放弃修改', '返回编辑'],
      defaultId: 1,
      cancelId: 1,
      title: '未保存的修改',
      message: `“${fileName ?? '当前文件'}”有未保存的修改，确定放弃吗？`,
    };
    const result = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);
    restoreWindowFocus(window);
    return result.response === 0;
  }
}
