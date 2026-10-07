/**
 * 题面 HTML → Markdown 的纯文本转换器。
 *
 * VJudge 的题面（`/problem/description/{key}`）是一份自包含 HTML，
 * 这里做**容错、够用**的转换：保留标题、列表、表格、代码块、图片与链接，
 * 丢弃脚本与样式，并把 MathJax 定界符换成本项目预览更友好的 `$` / `$$`。
 * 不依赖 DOM，可在主进程与渲染进程同时使用。
 */

/** HTML 空元素（无闭合标签）。 */
const VOID_TAGS: ReadonlySet<string> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** 整块内容需要丢弃的元素。 */
const DROP_TAGS: ReadonlySet<string> = new Set([
  'address',
  'button',
  'embed',
  'form',
  'head',
  'iframe',
  'link',
  'meta',
  'noscript',
  'object',
  'script',
  'style',
  'title',
]);

/** 块级元素（前后需要空行分隔）。 */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'article',
  'aside',
  'blockquote',
  'caption',
  'center',
  'dd',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

interface IElement {
  readonly kind: 'element';
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: INode[];
}

interface IText {
  readonly kind: 'text';
  readonly text: string;
}

type INode = IElement | IText;

const TAG_TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)\/?>|([^<]+)/g;
const ATTR_TOKEN = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  copy: '©',
  divide: '÷',
  ge: '≥',
  gt: '>',
  hellip: '…',
  infin: '∞',
  laquo: '«',
  le: '≤',
  lt: '<',
  ldquo: '“',
  lsquo: '‘',
  mdash: '—',
  ndash: '–',
  nbsp: ' ',
  raquo: '»',
  rdquo: '”',
  rsquo: '’',
  times: '×',
  quot: '"',
};

/** 解码 HTML 文本与属性中的实体（单次扫描，`&amp;lt;` 不会被二次解码）。 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const codePoint =
        entity.startsWith('#x') || entity.startsWith('#X')
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    const named = NAMED_ENTITIES[entity.toLowerCase()];
    return named === undefined ? match : named;
  });
}

function parseAttributes(raw: string): Readonly<Record<string, string>> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(ATTR_TOKEN)) {
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    const name = match[1];
    if (name !== undefined) {
      attrs[name.toLowerCase()] = decodeHtmlEntities(value);
    }
  }
  return attrs;
}

function element(
  tag: string,
  attrs: Readonly<Record<string, string>> = {},
  children: INode[] = [],
): IElement {
  return { attrs, children, kind: 'element', tag };
}

/** 容错解析：未闭合标签并入父节点，多余闭合标签忽略。 */
function parseHtml(html: string): IElement {
  const root = element('root');
  const stack: IElement[] = [root];
  for (const match of html.matchAll(TAG_TOKEN)) {
    const [token, closeTag, openTag, attrRaw, text] = match;
    const parent = stack[stack.length - 1] ?? root;
    if (token.startsWith('<!')) {
      continue;
    }
    if (closeTag !== undefined) {
      const tag = closeTag.toLowerCase();
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index]?.tag === tag) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    if (openTag !== undefined) {
      const tag = openTag.toLowerCase();
      const node = element(tag, parseAttributes(attrRaw ?? ''));
      parent.children.push(node);
      // 丢弃类元素也要入栈：否则其正文（如 script 里的代码）会挂到父节点泄漏为文本
      if (!VOID_TAGS.has(tag) && !token.endsWith('/>')) {
        stack.push(node);
      }
      continue;
    }
    if (text !== undefined) {
      parent.children.push({ kind: 'text', text: decodeHtmlEntities(text) });
    }
  }
  return root;
}

/** 列表序号槽：同一 frame 被本层所有 li 共享，渲染时递增。 */
interface IListFrame {
  index: number;
  readonly tag: 'ol' | 'ul';
}

interface IRenderState {
  readonly listStack: readonly IListFrame[];
  readonly quoteDepth: number;
}

function isBlockTag(tag: string): boolean {
  return BLOCK_TAGS.has(tag);
}

function collapseInline(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/**
 * 把 MathJax 定界符换成 `$` / `$$`，便于后续接入公式渲染。
 * 围栏代码块内的内容原样保留（题面常给出 `\(x\)` 形式的输入样例）。
 */
function normalizeMathOutsideCode(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?```)/g)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .replace(/\\\(([\s\S]*?)\\\)/g, (_, body: string) => `$${body.trim()}$`)
            .replace(/\\\[([\s\S]*?)\\\]/g, (_, body: string) => `\n\n$$\n${body.trim()}\n$$\n\n`),
    )
    .join('');
}

function attr(node: IElement, name: string): string {
  return node.attrs[name] ?? '';
}

function renderInline(nodes: readonly INode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.kind === 'text') {
      out += collapseInline(node.text);
      continue;
    }
    if (DROP_TAGS.has(node.tag)) {
      continue;
    }
    const children = renderInline(node.children);
    const trimmed = children.trim();
    switch (node.tag) {
      case 'br':
        out += '\n';
        break;
      case 'img': {
        const src = attr(node, 'src') || attr(node, 'data-src');
        out += src.length > 0 ? `![${attr(node, 'alt')}](${src})` : '';
        break;
      }
      case 'a':
        out +=
          attr(node, 'href').length > 0 && trimmed.length > 0
            ? `[${trimmed}](${attr(node, 'href')})`
            : children;
        break;
      case 'code':
      case 'kbd':
      case 'samp':
      case 'tt':
      case 'var':
        out += trimmed.length > 0 ? `\`${trimmed.replace(/`/g, "'")}\`` : '';
        break;
      case 'b':
      case 'strong':
        out += trimmed.length > 0 ? `**${trimmed}**` : '';
        break;
      case 'cite':
      case 'em':
      case 'i':
        out += trimmed.length > 0 ? `*${trimmed}*` : '';
        break;
      case 'del':
      case 's':
      case 'strike':
        out += trimmed.length > 0 ? `~~${trimmed}~~` : '';
        break;
      default:
        out += children;
    }
  }
  return out;
}

function collectText(nodes: readonly INode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.kind === 'text') {
      out += node.text;
    } else if (node.tag === 'br') {
      out += '\n';
    } else {
      out += collectText(node.children);
    }
  }
  return out;
}

function renderPre(node: IElement): string {
  const code = collectText(node.children)
    .replace(/\r\n?/g, '\n')
    .replace(/^\n+|\n+$/g, '');
  const language = /language-([\w+#-]+)/.exec(attr(node, 'class'))?.[1] ?? '';
  return `\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n`;
}

function renderTable(node: IElement): string {
  const rows: string[][] = [];
  const walk = (nodes: readonly INode[]): void => {
    for (const child of nodes) {
      if (child.kind !== 'element') {
        continue;
      }
      if (child.tag === 'tr') {
        const cells: string[] = [];
        for (const cell of child.children) {
          if (cell.kind === 'element' && (cell.tag === 'td' || cell.tag === 'th')) {
            cells.push(collapseInline(renderInline(cell.children)).trim().replace(/\|/g, '\\|'));
          }
        }
        if (cells.length > 0) {
          rows.push(cells);
        }
      } else {
        walk(child.children);
      }
    }
  };
  walk(node.children);
  const first = rows[0];
  if (first === undefined) {
    return '';
  }
  const width = Math.max(...rows.map((row) => row.length));
  const pad = (row: readonly string[]): string[] =>
    Array.from({ length: width }, (_, index) => row[index] ?? '');
  const lines = [
    `| ${pad(first).join(' | ')} |`,
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...rows.slice(1).map((row) => `| ${pad(row).join(' | ')} |`),
  ];
  return `\n\n${lines.join('\n')}\n\n`;
}

function renderChildren(node: IElement, state: IRenderState): string {
  let out = '';
  let pending: INode[] = [];
  const flush = (): void => {
    if (pending.length === 0) {
      return;
    }
    const text = collapseInline(renderInline(pending)).trim();
    if (text.length > 0) {
      out += `\n\n${text}\n\n`;
    }
    pending = [];
  };
  for (const child of node.children) {
    if (child.kind === 'element' && DROP_TAGS.has(child.tag)) {
      continue;
    }
    if (child.kind === 'text' || !isBlockTag(child.tag)) {
      pending.push(child);
      continue;
    }
    flush();
    out += renderBlock(child, state);
  }
  flush();
  return out;
}

function renderBlock(node: IElement, state: IRenderState): string {
  if (DROP_TAGS.has(node.tag)) {
    return '';
  }
  if (node.tag === 'pre') {
    return renderPre(node);
  }
  if (node.tag === 'table') {
    return renderTable(node);
  }
  if (/^h[1-6]$/.test(node.tag)) {
    const depth = Number.parseInt(node.tag.slice(1), 10);
    const text = collapseInline(renderInline(node.children)).trim();
    return text.length === 0 ? '' : `\n\n${'#'.repeat(depth)} ${text}\n\n`;
  }
  if (node.tag === 'hr') {
    return '\n\n---\n\n';
  }
  if (node.tag === 'img') {
    const src = attr(node, 'src') || attr(node, 'data-src');
    return src.length > 0 ? `\n\n![${attr(node, 'alt')}](${src})\n\n` : '';
  }
  if (node.tag === 'li') {
    const body = renderChildren(element('group', {}, node.children), state)
      .trim()
      .replace(/\n{2,}/g, '\n');
    const top = state.listStack[state.listStack.length - 1];
    const indent = '  '.repeat(Math.max(0, state.listStack.length - 1));
    const marker = top !== undefined && top.tag === 'ol' ? `${top.index}. ` : '- ';
    return `\n${indent}${marker}${body}\n`;
  }
  if (node.tag === 'ul' || node.tag === 'ol') {
    // 可变计数器：同一个 frame 对象被所有 li 共享，序号随渲染递增
    const frame: IListFrame = { index: 1, tag: node.tag === 'ol' ? 'ol' : 'ul' };
    const listState: IRenderState = {
      listStack: [...state.listStack, frame],
      quoteDepth: state.quoteDepth,
    };
    let out = '';
    for (const child of node.children) {
      if (child.kind === 'element' && child.tag === 'li') {
        out += renderBlock(child, listState);
        frame.index += 1;
      } else if (child.kind === 'element') {
        out += renderBlock(child, listState);
      }
    }
    return `\n${out}\n`;
  }
  if (node.tag === 'blockquote') {
    const inner = renderChildren(node, { ...state, quoteDepth: state.quoteDepth + 1 }).trim();
    const prefix = '> '.repeat(state.quoteDepth + 1);
    return `\n\n${inner
      .split('\n')
      .map((line) => `${prefix}${line}`)
      .join('\n')}\n\n`;
  }
  const hasBlockChild = node.children.some(
    (child) => child.kind === 'element' && isBlockTag(child.tag),
  );
  if (!hasBlockChild) {
    const text = collapseInline(renderInline(node.children)).trim();
    return text.length === 0 ? '' : `\n\n${text}\n\n`;
  }
  return renderChildren(node, state);
}

/**
 * 把题面 HTML 转成 Markdown。
 * @param html 题面原始 HTML（整份文档或片段皆可）
 */
export function htmlToMarkdown(html: string): string {
  if (html.trim().length === 0) {
    return '';
  }
  const body = /<body[\s\S]*?>/i.test(html)
    ? html.replace(/^[\s\S]*?<body[\s\S]*?>/i, '').replace(/<\/body>[\s\S]*$/i, '')
    : html;
  const markdown = renderChildren(parseHtml(body), { listStack: [], quoteDepth: 0 });
  return normalizeMathOutsideCode(markdown)
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
