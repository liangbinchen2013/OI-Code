import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEye } from '@fortawesome/free-solid-svg-icons';
import type { ReactElement } from 'react';
import { renderMarkdown } from './markdown';
import { WORKBENCH_STRINGS } from './strings';

export interface IPreviewDocument {
  readonly name: string;
  readonly content: string;
}

export interface IPreviewPanelProps {
  readonly document: IPreviewDocument | undefined;
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1).toLowerCase() : '';
}

/**
 * 分屏预览面板：Markdown 实时渲染、HTML 沙箱预览，其余类型给出提示。
 */
export function PreviewPanel({ document }: IPreviewPanelProps) {
  let body: ReactElement;
  if (document === undefined) {
    body = <p className="oi-preview-empty">{WORKBENCH_STRINGS.previewNoDocument}</p>;
  } else {
    const extension = extensionOf(document.name);
    if (extension === 'md' || extension === 'markdown') {
      body = (
        <article
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
