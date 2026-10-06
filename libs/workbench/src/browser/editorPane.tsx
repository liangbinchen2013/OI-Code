import { DisposableStore } from '@oi/base';
import type { URI } from '@oi/base';
import type { ILanguageService } from '@oi/editor';
import { createCodeEditor, type ICodeEditor } from '@oi/editor/browser';
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react';

/**
 * 编辑器面板向父组件暴露的最小命令面。
 */
export interface IEditorPaneHandle {
  getValue(): string;
  setContent(text: string, uri: URI): void;
  focus(): void;
}

export interface IEditorPaneProps {
  readonly languageService: ILanguageService;
  readonly onDidChangeContent: () => void;
  readonly onSaveRequested: () => void;
  readonly ref?: Ref<IEditorPaneHandle | null>;
}

/**
 * Monaco 编辑器宿主：管理编辑器生命周期，通过 ref 暴露命令面。
 */
export function EditorPane({
  languageService,
  onDidChangeContent,
  onSaveRequested,
  ref,
}: IEditorPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<ICodeEditor | null>(null);
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
      instance.onDidChangeContent(() => {
        changeHandlerRef.current();
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
      getValue: () => editor?.getValue() ?? '',
      setContent: (text: string, uri: URI): void => {
        editor?.setContent(text, uri);
      },
      focus: (): void => {
        editor?.focus();
      },
    }),
    [editor],
  );

  return <div className="oi-editor-host" ref={hostRef} />;
}
