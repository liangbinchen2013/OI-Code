import { DisposableStore, URI } from '@oi/base';
import type { ILanguageService } from '@oi/editor';
import { createCodeEditor, type ICodeEditorHost } from '@oi/editor/browser';
import { useEffect, useRef, useState } from 'react';

export interface ITemplateContentEditorProps {
  readonly languageService: ILanguageService;
  readonly extension: string;
  readonly content: string;
  readonly fontSize?: number;
  readonly tabSize?: number;
  readonly onChange: (content: string) => void;
}

const TEMPLATE_EDITOR_PATH = '/template-preview';

/**
 * 模板内容编辑器：复用主编辑器同款 Monaco（Tab 缩进 / 语法高亮 / 括号配对）。
 * 扩展名变化时重建实例以刷新语言；重建内容取当前草稿，避免丢失输入。
 */
export function TemplateContentEditor({
  languageService,
  extension,
  content,
  fontSize,
  tabSize,
  onChange,
}: ITemplateContentEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const contentRef = useRef(content);
  const [editor, setEditor] = useState<ICodeEditorHost | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    contentRef.current = content;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }
    const normalizedExtension = extension.trim().replace(/^\.+/, '');
    const suffix = normalizedExtension.length > 0 ? `.${normalizedExtension}` : '';
    const uri = URI.from({ scheme: 'oi-template', path: `${TEMPLATE_EDITOR_PATH}${suffix}` });
    const store = new DisposableStore();
    const instance = createCodeEditor({
      container: host,
      languageService,
      ...(fontSize === undefined ? {} : { fontSize }),
      ...(tabSize === undefined ? {} : { tabSize }),
    });
    store.add(instance);
    instance.openDocument(uri, contentRef.current);
    store.add(
      instance.onDidChangeContent(() => {
        onChangeRef.current(instance.getValue(uri));
      }),
    );
    setEditor(instance);
    return () => {
      setEditor(null);
      store.dispose();
    };
    // fontSize/tabSize 仅作为初始值，运行期变更由下方 effect 更新
  }, [extension, languageService]);

  useEffect(() => {
    if (editor === null || fontSize === undefined || tabSize === undefined) {
      return;
    }
    editor.updateOptions({ fontSize, tabSize });
  }, [editor, fontSize, tabSize]);

  return <div className="oi-template-content-editor" ref={hostRef} />;
}
