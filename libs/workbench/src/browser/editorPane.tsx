import { DisposableStore } from '@oi/base';
import type { URI } from '@oi/base';
import type { ILanguageService } from '@oi/editor';
import {
  createCodeEditor,
  type ICodeEditorHost,
  type IDirtyDocument,
  type IEditorMarker,
} from '@oi/editor/browser';
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';

/**
 * 编辑器面板向父组件暴露的文档级命令面。
 */
export interface IEditorPaneHandle {
  openDocument(uri: URI, text: string): void;
  closeDocument(uri: URI): void;
  replaceDocument(previousUri: URI, nextUri: URI, text: string): void;
  setActiveDocument(uri: URI | undefined): void;
  getValue(uri: URI): string;
  hasDocument(uri: URI): boolean;
  getDirtyDocuments(): readonly IDirtyDocument[];
  markSaved(uri: URI): void;
  setLanguage(uri: URI, languageId: string): void;
  setMarkers(uri: URI, markers: readonly IEditorMarker[]): void;
  revealPosition(uri: URI, line: number, column: number): void;
  focus(): void;
}

export interface IEditorPaneProps {
  readonly languageService: ILanguageService;
  readonly onDidChangeContent: (uri: URI) => void;
  readonly onSaveRequested: () => void;
  readonly onDidFocus?: () => void;
  /** 初次就绪时自动打开的文档（分屏副编辑器用）；已打开时跳过。 */
  readonly documentUri?: URI;
  readonly documentText?: string;
  readonly fontSize?: number;
  readonly tabSize?: number;
  readonly ref?: Ref<IEditorPaneHandle | null>;
}

/**
 * Monaco 编辑器宿主：管理多文档编辑器生命周期，通过 ref 暴露命令面。
 */
export function EditorPane({
  languageService,
  onDidChangeContent,
  onSaveRequested,
  onDidFocus,
  documentUri,
  documentText,
  fontSize,
  tabSize,
  ref,
}: IEditorPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<ICodeEditorHost | null>(null);
  const changeHandlerRef = useRef(onDidChangeContent);
  const saveHandlerRef = useRef(onSaveRequested);
  const focusHandlerRef = useRef(onDidFocus);
  const documentTextRef = useRef(documentText);

  useEffect(() => {
    documentTextRef.current = documentText;
  });

  useEffect(() => {
    changeHandlerRef.current = onDidChangeContent;
  }, [onDidChangeContent]);

  useEffect(() => {
    saveHandlerRef.current = onSaveRequested;
  }, [onSaveRequested]);

  useEffect(() => {
    focusHandlerRef.current = onDidFocus;
  }, [onDidFocus]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const store = new DisposableStore();
    const instance = createCodeEditor({
      container: host,
      languageService,
      ...(fontSize === undefined ? {} : { fontSize }),
      ...(tabSize === undefined ? {} : { tabSize }),
    });
    store.add(instance);
    store.add(
      instance.onDidChangeContent((uri) => {
        changeHandlerRef.current(uri);
      }),
    );
    store.add(
      instance.addSaveCommand(() => {
        saveHandlerRef.current();
      }),
    );
    store.add(
      instance.onDidFocus(() => {
        focusHandlerRef.current?.();
      }),
    );
    setEditor(instance);
    return () => {
      setEditor(null);
      store.dispose();
    };
  }, [languageService]);

  // 设置变更即时应用到已创建的编辑器
  useEffect(() => {
    if (fontSize === undefined || tabSize === undefined) {
      return;
    }
    editor?.updateOptions({ fontSize, tabSize });
  }, [editor, fontSize, tabSize]);

  // 编辑器就绪后打开指定文档（分屏副编辑器）；已打开则不重复刷新
  useEffect(() => {
    if (editor === null || documentUri === undefined || editor.hasDocument(documentUri)) {
      return;
    }
    editor.openDocument(documentUri, documentTextRef.current ?? '');
  }, [editor, documentUri]);

  useImperativeHandle(
    ref,
    () => ({
      openDocument: (uri: URI, text: string): void => {
        editor?.openDocument(uri, text);
      },
      closeDocument: (uri: URI): void => {
        editor?.closeDocument(uri);
      },
      replaceDocument: (previousUri: URI, nextUri: URI, text: string): void => {
        editor?.replaceDocument(previousUri, nextUri, text);
      },
      setActiveDocument: (uri: URI | undefined): void => {
        editor?.setActiveDocument(uri);
      },
      getValue: (uri: URI): string => editor?.getValue(uri) ?? '',
      hasDocument: (uri: URI): boolean => editor?.hasDocument(uri) ?? false,
      getDirtyDocuments: (): readonly IDirtyDocument[] => editor?.getDirtyDocuments() ?? [],
      markSaved: (uri: URI): void => {
        editor?.markSaved(uri);
      },
      setLanguage: (uri: URI, languageId: string): void => {
        editor?.setLanguage(uri, languageId);
      },
      setMarkers: (uri: URI, markers: readonly IEditorMarker[]): void => {
        editor?.setMarkers(uri, markers);
      },
      revealPosition: (uri: URI, line: number, column: number): void => {
        editor?.revealPosition(uri, line, column);
      },
      focus: (): void => {
        editor?.focus();
      },
    }),
    [editor],
  );

  return <div className="oi-editor-host" ref={hostRef} />;
}
