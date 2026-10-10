import { DisposableStore, URI } from '@oi/base';
import type { ILanguageService } from '@oi/editor';
import { createCodeEditor, type ICodeEditorHost } from '@oi/editor/browser';
import { useEffect, useId, useRef } from 'react';

export interface ICodeFieldProps {
  readonly languageService: ILanguageService;
  readonly value: string;
  readonly ariaLabel: string;
  /** 宿主容器没有固有高度，Monaco 需要显式高度。 */
  readonly heightPx: number;
  readonly readOnly?: boolean;
  /** 稳定的测试锚点（E2E 用它定位具体代码框）。 */
  readonly testId?: string;
  readonly fontSize?: number;
  readonly tabSize?: number;
  readonly onChange?: (value: string) => void;
}

/**
 * 工具面板里的代码输入框：与主编辑器同款 Monaco（语法高亮、缩进、括号配对）。
 * 只读区（格式化结果）用 `readOnly`，外部改写值时不会丢撤销栈。
 */
export function CodeField({
  languageService,
  value,
  ariaLabel,
  heightPx,
  readOnly = false,
  testId,
  fontSize,
  tabSize,
  onChange,
}: ICodeFieldProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<ICodeEditorHost | undefined>(undefined);
  /** 最近一次由本组件写入/收到的值，用来区分"外部回填"和"用户输入"。 */
  const knownRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const uriRef = useRef<URI | undefined>(undefined);
  const id = useId();

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return undefined;
    }
    const uri = URI.from({ scheme: 'oi-tool-field', path: `/field${id.replace(/:/g, '')}.cpp` });
    uriRef.current = uri;
    const store = new DisposableStore();
    const editor = createCodeEditor({
      container: host,
      languageService,
      readOnly,
      ...(fontSize === undefined ? {} : { fontSize }),
      ...(tabSize === undefined ? {} : { tabSize }),
    });
    store.add(editor);
    editor.ensureDocument(uri, knownRef.current);
    editor.showDocument(uri);
    editorRef.current = editor;
    store.add(
      editor.onDidChangeContent(() => {
        const next = editor.getValue(uri);
        knownRef.current = next;
        onChangeRef.current?.(next);
      }),
    );
    return () => {
      store.dispose();
      editorRef.current = undefined;
      uriRef.current = undefined;
    };
  }, [id, languageService, readOnly]);

  useEffect(() => {
    const editor = editorRef.current;
    const uri = uriRef.current;
    if (editor === undefined || uri === undefined) {
      return;
    }
    editor.updateOptions({
      ...(fontSize === undefined ? {} : { fontSize }),
      ...(tabSize === undefined ? {} : { tabSize }),
    });
  }, [fontSize, tabSize]);

  useEffect(() => {
    const editor = editorRef.current;
    const uri = uriRef.current;
    if (editor === undefined || uri === undefined || value === knownRef.current) {
      return;
    }
    knownRef.current = value;
    editor.setValue(uri, value);
  }, [value]);

  return (
    <div
      className="oi-code-field"
      ref={hostRef}
      role="group"
      aria-label={ariaLabel}
      data-oi-field={testId}
      style={{ height: `${heightPx}px` }}
    />
  );
}
