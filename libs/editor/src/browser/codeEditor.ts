import {
  DisposableStore,
  Emitter,
  URI,
  type Event,
  type IDisposable,
  toDisposable,
} from '@oi/base';
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

/** 诊断标记归属者，供 Monaco marker 管理与清理。 */
const MARKER_OWNER = 'oi-code';

export type EditorMarkerSeverity = 'error' | 'warning' | 'info';

/**
 * 编辑器诊断标记：line/column 从 1 起；line 为 0 时收敛到第 1 行。
 */
export interface IEditorMarker {
  readonly severity: EditorMarkerSeverity;
  readonly message: string;
  readonly line: number;
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
}

function toMonacoSeverity(severity: EditorMarkerSeverity): monaco.MarkerSeverity {
  if (severity === 'error') {
    return monaco.MarkerSeverity.Error;
  }
  if (severity === 'warning') {
    return monaco.MarkerSeverity.Warning;
  }
  return monaco.MarkerSeverity.Info;
}

function toMonacoMarker(marker: IEditorMarker): monaco.editor.IMarkerData {
  const line = Math.max(1, marker.line);
  const column = Math.max(1, marker.column);
  const endLine = Math.max(line, marker.endLine ?? line);
  const endColumn =
    endLine === line
      ? Math.max(column, marker.endColumn ?? column)
      : Math.max(1, marker.endColumn ?? 1);
  return {
    severity: toMonacoSeverity(marker.severity),
    message: marker.message,
    startLineNumber: line,
    startColumn: column,
    endLineNumber: endLine,
    endColumn,
  };
}

/** 有未保存修改的文档快照，供自动保存轮询。 */
export interface IDirtyDocument {
  readonly uri: URI;
  readonly content: string;
}

export interface ICreateCodeEditorOptions {
  readonly container: HTMLElement;
  readonly languageService: ILanguageService;
}

/**
 * 多文档代码编辑器门面：单个 Monaco 实例 + 每个文档一个 model。
 * 工作台只依赖此接口，Monaco 细节封装在 editor 层内部。
 */
export interface ICodeEditorHost extends IDisposable {
  /** 用户输入导致的内容变化，携带所属文档 URI；程序性写入不触发。 */
  readonly onDidChangeContent: Event<URI>;
  /** 打开文档并设为当前；已打开时刷新内容。 */
  openDocument(uri: URI, text: string): void;
  /** 关闭文档并释放其 model；若为当前文档则清空编辑器。 */
  closeDocument(uri: URI): void;
  /** 另存为：用新 URI 重建文档（保持内容）并设为当前。 */
  replaceDocument(previousUri: URI, nextUri: URI, text: string): void;
  /** 切换当前文档；undefined 表示清空。 */
  setActiveDocument(uri: URI | undefined): void;
  getValue(uri: URI): string;
  hasDocument(uri: URI): boolean;
  /** 有未保存修改的全部文档（按最近变更为序）。 */
  getDirtyDocuments(): readonly IDirtyDocument[];
  /** 标记文档已落盘（保存成功后调用），从脏集合移除。 */
  markSaved(uri: URI): void;
  /** 设置文档诊断标记；重复调用整体替换。 */
  setMarkers(uri: URI, markers: readonly IEditorMarker[]): void;
  /** 滚动并聚焦到指定位置（1 起始）；文档已打开时生效。 */
  revealPosition(uri: URI, line: number, column: number): void;
  /** 绑定 Ctrl+S 保存命令，返回句柄用于解绑。 */
  addSaveCommand(handler: () => void): IDisposable;
  focus(): void;
}

interface IOpenDocument {
  readonly model: monaco.editor.ITextModel;
  readonly changeSubscription: IDisposable;
}

class CodeEditorHost implements ICodeEditorHost {
  private readonly _disposables = new DisposableStore();
  private readonly _onDidChangeContent = new Emitter<URI>();
  private readonly _editor: monaco.editor.IStandaloneCodeEditor;
  private readonly _languageService: ILanguageService;
  private readonly _documents = new Map<string, IOpenDocument>();
  private readonly _dirtyUris = new Set<string>();
  private _isProgrammatic = false;

  constructor(options: ICreateCodeEditorOptions) {
    ensureMonacoEnvironment();
    applyWorkbenchTheme(currentThemeKind());
    this._languageService = options.languageService;
    this._editor = monaco.editor.create(options.container, {
      model: null,
      theme: themeIdFor(currentThemeKind()),
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: EDITOR_FONT_SIZE,
      tabSize: EDITOR_TAB_SIZE,
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      // 括号按嵌套层级着色并显示配对连接线
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, bracketPairsHorizontal: true },
    });
    this._disposables.add(this._onDidChangeContent);
    this._disposables.add(toDisposable(() => this._editor.dispose()));
    this._disposables.add(toDisposable(() => this._disposeDocuments()));
  }

  get onDidChangeContent(): Event<URI> {
    return this._onDidChangeContent.event;
  }

  openDocument(uri: URI, text: string): void {
    const key = uri.toString();
    const existing = this._documents.get(key);
    if (existing) {
      this._isProgrammatic = true;
      try {
        existing.model.setValue(text);
      } finally {
        this._isProgrammatic = false;
      }
      this._dirtyUris.delete(key);
      this._editor.setModel(existing.model);
      this._editor.focus();
      return;
    }
    const model = monaco.editor.createModel(text, this._languageIdOf(uri), monaco.Uri.parse(key));
    const changeSubscription = model.onDidChangeContent(() => {
      if (!this._isProgrammatic) {
        this._dirtyUris.add(key);
        this._onDidChangeContent.fire(uri);
      }
    });
    this._documents.set(key, { model, changeSubscription });
    this._editor.setModel(model);
    this._editor.focus();
  }

  closeDocument(uri: URI): void {
    const key = uri.toString();
    const document = this._documents.get(key);
    if (!document) {
      return;
    }
    const isActive = this._editor.getModel() === document.model;
    document.changeSubscription.dispose();
    document.model.dispose();
    this._documents.delete(key);
    this._dirtyUris.delete(key);
    if (isActive) {
      this._editor.setModel(null);
    }
  }

  replaceDocument(previousUri: URI, nextUri: URI, text: string): void {
    this.closeDocument(previousUri);
    this.openDocument(nextUri, text);
  }

  setActiveDocument(uri: URI | undefined): void {
    if (uri === undefined) {
      this._editor.setModel(null);
      return;
    }
    const document = this._documents.get(uri.toString());
    if (!document) {
      throw new Error(`文档未打开：${uri.toString()}`);
    }
    this._editor.setModel(document.model);
    this._editor.focus();
  }

  getValue(uri: URI): string {
    return this._documents.get(uri.toString())?.model.getValue() ?? '';
  }

  hasDocument(uri: URI): boolean {
    return this._documents.has(uri.toString());
  }

  getDirtyDocuments(): readonly IDirtyDocument[] {
    const dirty: IDirtyDocument[] = [];
    for (const key of this._dirtyUris) {
      const document = this._documents.get(key);
      if (document !== undefined) {
        dirty.push({ uri: URI.parse(key), content: document.model.getValue() });
      }
    }
    return dirty;
  }

  markSaved(uri: URI): void {
    this._dirtyUris.delete(uri.toString());
  }

  setMarkers(uri: URI, markers: readonly IEditorMarker[]): void {
    const document = this._documents.get(uri.toString());
    if (!document) {
      return;
    }
    monaco.editor.setModelMarkers(document.model, MARKER_OWNER, markers.map(toMonacoMarker));
  }

  revealPosition(uri: URI, line: number, column: number): void {
    const document = this._documents.get(uri.toString());
    if (!document) {
      return;
    }
    if (this._editor.getModel() !== document.model) {
      this._editor.setModel(document.model);
    }
    const position = {
      lineNumber: Math.max(1, line),
      column: Math.max(1, column),
    };
    this._editor.setPosition(position);
    this._editor.revealPositionInCenter(position);
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

  private _disposeDocuments(): void {
    for (const document of this._documents.values()) {
      document.changeSubscription.dispose();
      document.model.dispose();
    }
    this._documents.clear();
    this._dirtyUris.clear();
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

export function createCodeEditor(options: ICreateCodeEditorOptions): ICodeEditorHost {
  return new CodeEditorHost(options);
}
