import { onUnexpectedError } from '@oi/base';
import type { ThemeKind } from '@oi/editor/browser';
import { colorizeCode } from '@oi/editor/browser';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEye } from '@fortawesome/free-solid-svg-icons';
import { useEffect, useRef, type ReactElement } from 'react';
import { renderMarkdown } from './markdown';
import { WORKBENCH_STRINGS } from './strings';

export interface IPreviewDocument {
  readonly name: string;
  readonly content: string;
}

export interface IPreviewPanelProps {
  readonly document: IPreviewDocument | undefined;
  /** 主题变化时重新着色代码块。 */
  readonly theme?: ThemeKind;
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1).toLowerCase() : '';
}

/** 该文件是否可在分屏面板中直接预览（Markdown / HTML）。 */
export function isPreviewableName(name: string): boolean {
  const extension = extensionOf(name);
  return (
    extension === 'md' || extension === 'markdown' || extension === 'html' || extension === 'htm'
  );
}

/**
 * 分屏预览面板：Markdown 实时渲染（表格 + Monaco 代码高亮）、HTML 沙箱预览，
 * 其余类型给出提示。
 */
export function PreviewPanel({ document, theme }: IPreviewPanelProps) {
  const markdownRef = useRef<HTMLElement | null>(null);
  const markdownContent = document?.content;

  // 代码块二次处理：用 Monaco 词法着色替换纯文本
  useEffect(() => {
    const root = markdownRef.current;
    if (root === null || markdownContent === undefined) {
      return undefined;
    }
    let cancelled = false;
    const blocks = root.querySelectorAll<HTMLElement>('pre.oi-md-code[data-language]');
    for (const block of blocks) {
      const language = block.dataset['language'] ?? 'plaintext';
      const code = block.textContent ?? '';
      void colorizeCode(code, language).then(
        (highlighted) => {
          if (!cancelled) {
            block.innerHTML = highlighted;
          }
        },
        (error: unknown) => onUnexpectedError(error),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [markdownContent, theme]);

  let body: ReactElement;
  if (document === undefined) {
    body = <p className="oi-preview-empty">{WORKBENCH_STRINGS.previewNoDocument}</p>;
  } else {
    const extension = extensionOf(document.name);
    if (extension === 'md' || extension === 'markdown') {
      body = (
        <article
          ref={markdownRef}
          className="oi-preview-markdown"
          // 内容已经 renderMarkdown 转义，仅生成受控标签
          dangerouslySetInnerHTML={{ __html: renderMarkdown(document.content) }}
        />
      );
    } else if (extension === 'html' || extension === 'htm') {
      body = (
        <iframe
          className="oi-preview-frame"
          sandbox=""
          srcDoc={document.content}
          title={`${WORKBENCH_STRINGS.preview}：${document.name}`}
        />
      );
    } else {
      body = <p className="oi-preview-empty">{WORKBENCH_STRINGS.previewUnsupported}</p>;
    }
  }

  return (
    <section className="oi-preview" aria-label={WORKBENCH_STRINGS.preview}>
      <header className="oi-preview-header">
        <FontAwesomeIcon icon={faEye} aria-hidden="true" />
        <span className="oi-preview-title">{WORKBENCH_STRINGS.preview}</span>
        {document !== undefined ? <span className="oi-preview-file">{document.name}</span> : null}
      </header>
      <div className="oi-preview-body">{body}</div>
    </section>
  );
}
