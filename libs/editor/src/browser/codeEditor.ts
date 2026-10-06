import { DisposableStore, Emitter, type Event, type IDisposable, toDisposable } from '@oi/base';
import type { URI } from '@oi/base';
import * as monaco from 'monaco-editor/editor/editor.api';
import type { ILanguageService } from '../common/language';
import { getFileExtension } from '../common/languageService';
import {
  applyWorkbenchTheme,
  currentThemeKind,
  ensureMonacoEnvironment,
  themeIdFor,
} from './monacoEnvironment';

const EDITOR_FONT_SIZE = 14;
const EDITOR_TAB_SIZE = 4;

export interface ICreateCodeEditorOptions {
  readonly container: HTMLElement;
  readonly languageService: ILanguageService;
}

/**
 * 代码编辑器门面：工作台只依赖此接口，Monaco 细节封装在 editor 层内部。
 */
export interface ICodeEditor extends IDisposable {
  /** 用户输入导致的内容变化；程序调用 {@link setContent} 不触发。 */
  readonly onDidChangeContent: Event<void>;
  getValue(): string;
  /** 切换到新文档：替换内容与语言，复位光标与滚动位置。 */
  setContent(text: string, uri: URI): void;
  /** 绑定 Ctrl+S 保存命令，返回句柄用于解绑。 */
  addSaveCommand(handler: () => void): IDisposable;
  focus(): void;
}

class CodeEditor implements ICodeEditor {
  private readonly _disposables = new DisposableStore();
  private readonly _onDidChangeContent = new Emitter<void>();
  private readonly _editor: monaco.editor.IStandaloneCodeEditor;
  private readonly _languageService: ILanguageService;
  private _isSettingContent = false;

  constructor(options: ICreateCodeEditorOptions) {
    ensureMonacoEnvironment();
    applyWorkbenchTheme(currentThemeKind());
    this._languageService = options.languageService;
    this._editor = monaco.editor.create(options.container, {
      value: '',
      language: 'plaintext',
      theme: themeIdFor(currentThemeKind()),
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: EDITOR_FONT_SIZE,
      tabSize: EDITOR_TAB_SIZE,
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
    });
    this._disposables.add(this._onDidChangeContent);
    this._disposables.add(toDisposable(() => this._editor.dispose()));
    this._disposables.add(
      this._editor.onDidChangeModelContent(() => {
        if (!this._isSettingContent) {
          this._onDidChangeContent.fire();
        }
      }),
    );
  }

  get onDidChangeContent(): Event<void> {
    return this._onDidChangeContent.event;
  }

  getValue(): string {
    return this._editor.getValue();
  }

  setContent(text: string, uri: URI): void {
    const model = this._editor.getModel();
    if (!model) {
      throw new Error('编辑器模型未初始化');
    }
    this._isSettingContent = true;
    try {
      model.setValue(text);
      monaco.editor.setModelLanguage(model, this._languageIdOf(uri));
      this._editor.setPosition({ lineNumber: 1, column: 1 });
      this._editor.setScrollTop(0);
    } finally {
      this._isSettingContent = false;
    }
    this._editor.focus();
  }

  addSaveCommand(handler: () => void): IDisposable {
    return this._editor.addAction({
      id: 'oi-code.save',
      label: '保存',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        handler();
      },
    });
  }

  focus(): void {
    this._editor.focus();
  }

  dispose(): void {
    this._disposables.dispose();
  }

  private _languageIdOf(uri: URI): string {
    const fileName = uri.path.split('/').pop() ?? '';
    const byFileName = this._languageService.getLanguageByFileName(fileName);
    if (byFileName !== undefined) {
      return byFileName;
    }
    const extension = getFileExtension(uri.path);
    const byExtension =
      extension === undefined ? undefined : this._languageService.getLanguageByExtension(extension);
    return byExtension ?? 'plaintext';
  }
}

export function createCodeEditor(options: ICreateCodeEditorOptions): ICodeEditor {
  return new CodeEditor(options);
}
