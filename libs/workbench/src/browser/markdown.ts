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
/** 题面与笔记里的图片只允许 http(s)、站内路径与内联 data:image。 */
const SAFE_IMG = /^(https?:|\/|\.{1,2}\/|data:image\/)/i;
const TABLE_SEPARATOR_CELL = /^:?-{2,}:?$/;

/** 拆分表格行；无 `|` 或仅分隔线样式时返回 undefined。 */
function splitTableRow(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) {
    return undefined;
  }
  return trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableSeparator(row: readonly string[]): boolean {
  return row.length > 0 && row.every((cell) => TABLE_SEPARATOR_CELL.test(cell));
}

function renderInline(escaped: string): string {
  let result = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // 图片必须先于链接处理，否则 `![alt](src)` 会被链接规则吃掉剩下的 `!`
  result = result.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, alt: string, src: string) =>
    SAFE_IMG.test(src)
      ? `<img class="oi-md-image" src="${src}" alt="${alt}" loading="lazy">`
      : `<span>${alt}</span>`,
  );
  result = result.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) =>
    // 站外链接一律新窗口打开：主窗口的 `a` 点击会直接劫持应用页面
    SAFE_HREF.test(href)
      ? /^https?:/i.test(href)
        ? `<a href="${href}" target="_blank" rel="noreferrer noopener">${label}</a>`
        : `<a href="${href}" rel="noreferrer">${label}</a>`
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

  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (fenceOpen) {
      if (FENCE_CLOSE.test(line)) {
        html.push('</code></pre>');
        fenceOpen = false;
      } else {
        html.push(`${escapeHtml(line)}\n`);
      }
      continue;
    }
    // GitHub 风格表格：表头行 + 分隔行（|---|:--:|）触发
    const headerCells = splitTableRow(line);
    const separatorCells =
      headerCells === undefined ? undefined : splitTableRow(lines[index + 1] ?? '');
    if (
      headerCells !== undefined &&
      separatorCells !== undefined &&
      isTableSeparator(separatorCells)
    ) {
      flushParagraph();
      closeList();
      html.push('<table><thead><tr>');
      for (const cell of headerCells) {
        html.push(`<th>${renderInline(escapeHtml(cell))}</th>`);
      }
      html.push('</tr></thead><tbody>');
      index += 2;
      while (index < lines.length) {
        const bodyCells = splitTableRow(lines[index] ?? '');
        if (bodyCells === undefined) {
          index -= 1;
          break;
        }
        html.push('<tr>');
        for (let column = 0; column < headerCells.length; column += 1) {
          html.push(`<td>${renderInline(escapeHtml(bodyCells[column] ?? ''))}</td>`);
        }
        html.push('</tr>');
        index += 1;
      }
      html.push('</tbody></table>');
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
