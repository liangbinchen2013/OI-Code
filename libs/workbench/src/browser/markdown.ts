/**
 * 分屏预览用的极简 Markdown → HTML 渲染：
 * 支持标题、段落、无序列表、围栏代码块与常用行内语法。
 * 所有文本先转义再生成受控标签，不追求完整 CommonMark 兼容。
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const HEADING = /^(#{1,6})\s+(.+)$/;
const LIST_ITEM = /^\s*[-*]\s+(.+)$/;
const FENCE = /^\s*```(.*)$/;
const FENCE_CLOSE = /^\s*```\s*$/;
const SAFE_HREF = /^(https?:|#|\/|\.{1,2}\/)/i;

function renderInline(escaped: string): string {
  let result = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  result = result.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) =>
    SAFE_HREF.test(href)
      ? `<a href="${href}" rel="noreferrer">${label}</a>`
      : `<span>${label}</span>`,
  );
  return result;
}

export function renderMarkdown(source: string): string {
  const html: string[] = [];
  let paragraph: string[] = [];
  let listOpen = false;
  let fenceOpen = false;

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      html.push(`<p>${renderInline(escapeHtml(paragraph.join(' ')))}</p>`);
      paragraph = [];
    }
  };
  const closeList = (): void => {
    if (listOpen) {
      html.push('</ul>');
      listOpen = false;
    }
  };

  for (const line of source.split(/\r?\n/)) {
    if (fenceOpen) {
      if (FENCE_CLOSE.test(line)) {
        html.push('</code></pre>');
        fenceOpen = false;
      } else {
        html.push(`${escapeHtml(line)}\n`);
      }
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      closeList();
      fenceOpen = true;
      const language = (fence[1] ?? '').trim();
      html.push(
        language.length > 0
          ? `<pre class="oi-md-code" data-language="${escapeHtml(language)}"><code>`
          : '<pre class="oi-md-code"><code>',
      );
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const level = (heading[1] ?? '#').length;
      html.push(`<h${level}>${renderInline(escapeHtml(heading[2] ?? ''))}</h${level}>`);
      continue;
    }
    const listItem = LIST_ITEM.exec(line);
    if (listItem) {
      flushParagraph();
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      html.push(`<li>${renderInline(escapeHtml(listItem[1] ?? ''))}</li>`);
      continue;
    }
    if (line.trim().length === 0) {
      flushParagraph();
      closeList();
      continue;
    }
    closeList();
    paragraph.push(line);
  }
  if (fenceOpen) {
    html.push('</code></pre>');
  }
  flushParagraph();
  closeList();
  return html.join('\n');
}
