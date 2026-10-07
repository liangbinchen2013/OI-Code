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
  setMarkers(uri: URI, markers: readonly IEditorMarker[]): void;
  revealPosition(uri: URI, line: number, column: number): void;
  focus(): void;
}

export interface IEditorPaneProps {
  readonly languageService: ILanguageService;
  readonly onDidChangeContent: (uri: URI) => void;
  readonly onSaveRequested: () => void;
  readonly ref?: Ref<IEditorPaneHandle | null>;
}

/**
 * Monaco 编辑器宿主：管理多文档编辑器生命周期，通过 ref 暴露命令面。
 */
export function EditorPane({
  languageService,
  onDidChangeContent,
  onSaveRequested,
  ref,
}: IEditorPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<ICodeEditorHost | null>(null);
  const changeHandlerRef = useRef(onDidChangeContent);
  const saveHandlerRef = useRef(onSaveRequested);

  useEffect(() => {
    changeHandlerRef.current = onDidChangeContent;
  }, [onDidChangeContent]);

  useEffect(() => {
    saveHandlerRef.current = onSaveRequested;
  }, [onSaveRequested]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const store = new DisposableStore();
    const instance = createCodeEditor({ container: host, languageService });
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
    setEditor(instance);
    return () => {
      setEditor(null);
      store.dispose();
    };
  }, [languageService]);

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
