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
/**
 * 编辑器等宽字体栈。题面与预览里的代码块用 `--font-mono`（tokens.css）取同一条栈，
 * 改这里必须同步改那边，否则读参考代码和写代码会看到两种字形。
 */
const EDITOR_FONT_FAMILY = "Consolas, Monaco, 'Courier New', monospace";

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
  readonly fontSize?: number;
  readonly tabSize?: number;
}

/** 运行时可调整的编辑器显示选项。 */
export interface ICodeEditorOptionsUpdate {
  readonly fontSize?: number;
  readonly tabSize?: number;
}

/**
 * 多文档代码编辑器门面：单个 Monaco 实例 + 每个文档一个 model。
 * 工作台只依赖此接口，Monaco 细节封装在 editor 层内部。
 */
export interface ICodeEditorHost extends IDisposable {
  /** 用户输入导致的内容变化，携带所属文档 URI；程序性写入不触发。 */
  readonly onDidChangeContent: Event<URI>;
  /** 编辑器获得焦点（用于分屏时判定保存/编译目标）。 */
  readonly onDidFocus: Event<void>;
  /** 打开文档并设为当前；已打开时刷新内容。 */
  openDocument(uri: URI, text: string): void;
  /** 仅注册文档（共享模型/接收变更）但不切换当前显示；已打开时跳过。 */
  ensureDocument(uri: URI, text: string): void;
  /** 关闭文档并释放其 model；若为当前文档则清空编辑器。 */
  closeDocument(uri: URI): void;
  /** 另存为：用新 URI 重建文档（保持内容）并设为当前。 */
  replaceDocument(previousUri: URI, nextUri: URI, text: string): void;
  /** 切换当前文档；undefined 表示清空。 */
  setActiveDocument(uri: URI | undefined): void;
  getValue(uri: URI): string;
  /** 原地替换文档内容：保留 Monaco 撤销栈与脏标记（格式化、批量改写用）。 */
  setValue(uri: URI, text: string): void;
  hasDocument(uri: URI): boolean;
  /** 有未保存修改的全部文档（按最近变更为序）。 */
  getDirtyDocuments(): readonly IDirtyDocument[];
  /** 标记文档已落盘（保存成功后调用），从脏集合移除。 */
  markSaved(uri: URI): void;
  /** 运行时切换文档语言（如无扩展名文件按内容识别后）。 */
  setLanguage(uri: URI, languageId: string): void;
  /** 运行时更新显示选项（字号、制表符宽度等）。 */
  updateOptions(options: ICodeEditorOptionsUpdate): void;
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

/**
 * Monaco 模型按 URI 全局共享并计数：分屏双编辑器打开同一文档时
 * 编辑实时互通，最后一个宿主关闭后才释放模型。
 */
const MODEL_REF_COUNTS = new Map<string, number>();

class CodeEditorHost implements ICodeEditorHost {
  private readonly _disposables = new DisposableStore();
  private readonly _onDidChangeContent = new Emitter<URI>();
  private readonly _onDidFocus = new Emitter<void>();
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
      fontSize: options.fontSize ?? EDITOR_FONT_SIZE,
      fontFamily: EDITOR_FONT_FAMILY,
      tabSize: options.tabSize ?? EDITOR_TAB_SIZE,
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      // 括号按嵌套层级着色并显示配对连接线
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, bracketPairsHorizontal: true },
    });
    this._disposables.add(this._onDidChangeContent);
    this._disposables.add(this._onDidFocus);
    this._disposables.add(
      this._editor.onDidFocusEditorText(() => {
        this._onDidFocus.fire();
      }),
    );
    this._disposables.add(toDisposable(() => this._editor.dispose()));
    this._disposables.add(toDisposable(() => this._disposeDocuments()));
  }

  get onDidChangeContent(): Event<URI> {
    return this._onDidChangeContent.event;
  }

  get onDidFocus(): Event<void> {
    return this._onDidFocus.event;
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
    this.ensureDocument(uri, text);
    const registered = this._documents.get(key);
    if (registered !== undefined) {
      this._editor.setModel(registered.model);
      this._editor.focus();
    }
  }

  ensureDocument(uri: URI, text: string): void {
    const key = uri.toString();
    if (this._documents.has(key)) {
      return;
    }
    const modelUri = monaco.Uri.parse(key);
    const shared = monaco.editor.getModel(modelUri);
    const model = shared ?? monaco.editor.createModel(text, this._languageIdOf(uri), modelUri);
    const changeSubscription = model.onDidChangeContent(() => {
      if (!this._isProgrammatic) {
        this._dirtyUris.add(key);
        this._onDidChangeContent.fire(uri);
      }
    });
    this._documents.set(key, { model, changeSubscription });
    MODEL_REF_COUNTS.set(key, (MODEL_REF_COUNTS.get(key) ?? 0) + 1);
  }

  closeDocument(uri: URI): void {
    const key = uri.toString();
    const document = this._documents.get(key);
    if (!document) {
      return;
    }
    const isActive = this._editor.getModel() === document.model;
    document.changeSubscription.dispose();
    this._releaseModel(key, document.model);
    this._documents.delete(key);
    this._dirtyUris.delete(key);
    if (isActive) {
      this._editor.setModel(null);
    }
  }

  /** 递减模型引用计数，归零才真正释放（其它宿主可能仍在使用）。 */
  private _releaseModel(key: string, model: monaco.editor.ITextModel): void {
    const remaining = (MODEL_REF_COUNTS.get(key) ?? 1) - 1;
    if (remaining > 0) {
      MODEL_REF_COUNTS.set(key, remaining);
    } else {
      MODEL_REF_COUNTS.delete(key);
      model.dispose();
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

  setValue(uri: URI, text: string): void {
    const document = this._documents.get(uri.toString());
    if (document === undefined) {
      return;
    }
    const model = document.model;
    // 用整篇替换的编辑操作而不是 model.setValue()：后者会清空撤销栈，
    // 格式化后 Ctrl+Z 就回不去了
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
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

  setLanguage(uri: URI, languageId: string): void {
    const document = this._documents.get(uri.toString());
    if (document !== undefined) {
      monaco.editor.setModelLanguage(document.model, languageId);
    }
  }

  updateOptions(options: ICodeEditorOptionsUpdate): void {
    this._editor.updateOptions(options);
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
    for (const [key, document] of this._documents) {
      document.changeSubscription.dispose();
      this._releaseModel(key, document.model);
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
