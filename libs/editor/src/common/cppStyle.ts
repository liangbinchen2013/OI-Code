/**
 * C++ 代码风格模型与"从用户样本反推风格"的分析器。
 *
 * 目标不是通用 clang-format 的替身，而是把 OIer 真正在意的习惯量化出来：
 * 缩进、花括号位置、`if(true) continue;` 这类单语句体写法、一行塞几句的紧凑写法，
 * 以及各类语法之间"到底有没有空格"。
 * 注意：OIer 的空格习惯是分运算符的——`cin >> x` 通常带空格，
 * `for(int i=0;i<n;i++)` 通常不带，所以这里按组拆开判断，而不是一个开关管所有运算符。
 * "一行几句 / 整块一行"是写法习惯而非偏好：样本里出现过就该保留，
 * 写成多行往往只是因为那段本来就长，不构成反对证据（见 decidePresence）。
 * 样本不足时宁可回落默认值也不瞎猜。
 */
import {
  CPP_CONTROL_KEYWORDS,
  endsWithValue,
  isDeclaratorAt,
  templateArgumentRanges,
  tokenizeCpp,
  type ICppToken,
} from './cppLexer';

export interface ICppStyle {
  /** 缩进用 Tab 而不是空格 */
  readonly indentWithTabs: boolean;
  /** 一层缩进的宽度（空格数，或一个 Tab 折算的显示宽度） */
  readonly indentWidth: number;
  /** 左花括号另起一行（Allman）而不是跟在行尾（K&R） */
  readonly braceNextLine: boolean;
  /** 左花括号前留空格：`) {` / `){` */
  readonly spaceBeforeBrace: boolean;
  /** 单语句体与头部同行：`if (x) continue;`；false 时换行缩进 */
  readonly singleStatementOnSameLine: boolean;
  /** 原本整块写在一行时保持：`for (...) { a(); b(); }` */
  readonly allowShortBlocksOnOneLine: boolean;
  /** 原本一行写多条语句时保持：`int t; cin >> t;` */
  readonly allowMultipleStatementsPerLine: boolean;
  /** 控制关键字与左括号之间留空格：`if (` / `if(` */
  readonly spaceAfterControlKeyword: boolean;
  /** 圆括号内侧留空格：`if( x )` */
  readonly spaceInsideParens: boolean;
  /** 赋值运算符两侧：`a = b` / `a=b` */
  readonly spaceAroundAssignment: boolean;
  /** 比较运算符两侧：`i < n` / `i<n` */
  readonly spaceAroundComparison: boolean;
  /** 算术运算符两侧：`a + b` / `a+b` */
  readonly spaceAroundArithmetic: boolean;
  /** 位运算符两侧：`a & b` / `a&b` */
  readonly spaceAroundBitwise: boolean;
  /** 逻辑运算符两侧：`x && y` / `x&&y` */
  readonly spaceAroundLogical: boolean;
  /** `<<` 两侧（输出与左移）：`cout << x` / `cout<<x`、`1 << k` */
  readonly spaceAroundLeftShift: boolean;
  /** `>>` 两侧（输入与右移）：`cin >> x` / `cin>>x` */
  readonly spaceAroundRightShift: boolean;
  /** 三目运算符两侧：`a ? b : c` / `a?b:c` */
  readonly spaceAroundConditional: boolean;
  /** 逗号后留空格：`f(a, b)` / `f(a,b)` */
  readonly spaceAfterComma: boolean;
  /** for 头里分号后留空格 */
  readonly spaceAfterSemicolon: boolean;
  /** 指针/引用符号贴类型（`int* p`）还是贴变量（`int *p`） */
  readonly attachPointerToType: boolean;
  /** `} else {` 写法；false 时 else 另起一行 */
  readonly elseSameLine: boolean;
  /** `}` 与同行 `else` 之间留空格：`} else` / `}else` */
  readonly spaceBeforeElse: boolean;
  /** `case` 跟着 switch 体缩进；false 时 `case` 顶到 switch 那一层 */
  readonly indentCaseLabels: boolean;
  /** 允许保留的最大连续空行数 */
  readonly maxBlankLines: number;
}

export type BooleanStyleKey = Exclude<keyof ICppStyle, 'indentWidth' | 'maxBlankLines'>;

export const DEFAULT_CPP_STYLE: ICppStyle = {
  allowMultipleStatementsPerLine: false,
  allowShortBlocksOnOneLine: false,
  attachPointerToType: false,
  braceNextLine: false,
  elseSameLine: true,
  indentCaseLabels: true,
  indentWidth: 4,
  indentWithTabs: false,
  maxBlankLines: 2,
  singleStatementOnSameLine: false,
  spaceAfterComma: true,
  spaceAfterControlKeyword: true,
  spaceAfterSemicolon: true,
  spaceAroundArithmetic: true,
  spaceAroundAssignment: true,
  spaceAroundBitwise: true,
  spaceAroundComparison: true,
  spaceAroundConditional: true,
  spaceAroundLeftShift: true,
  spaceAroundLogical: true,
  spaceAroundRightShift: true,
  spaceBeforeBrace: true,
  spaceBeforeElse: true,
  spaceInsideParens: false,
};

/** 某个开关在样本里的正反例计数。 */
export interface IStyleEvidence {
  readonly key: BooleanStyleKey;
  readonly no: number;
  readonly yes: number;
}

export interface IStyleAnalysis {
  readonly style: ICppStyle;
  /** 0–1；样本太少时很低，UI 应提示"再多贴点代码" */
  readonly confidence: number;
  readonly evidence: readonly IStyleEvidence[];
  /** 统计到带缩进的行数，用于解释 indentWidth/Tab 的依据 */
  readonly indentedLines: number;
}

/** 运算符按语义分组，空格习惯逐组独立判断。 */
export const OPERATOR_GROUPS: ReadonlyArray<readonly [BooleanStyleKey, readonly string[]]> = [
  ['spaceAroundAssignment', ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']],
  ['spaceAroundComparison', ['==', '!=', '<', '>', '<=', '>=']],
  ['spaceAroundRightShift', ['>>']],
  ['spaceAroundLeftShift', ['<<']],
  ['spaceAroundArithmetic', ['+', '-', '*', '/', '%']],
  ['spaceAroundBitwise', ['&', '|', '^']],
  ['spaceAroundLogical', ['&&', '||']],
];

/** 参与"整块一行"投票的花括号最大跨度：更长的块写成多行不算风格表态。 */
const SHORT_BLOCK_TOKENS = 24;

/** 找到与 `openIndex` 处左括号配对的右括号下标；找不到返回 -1。 */
function matchClose(
  tokens: readonly ICppToken[],
  openIndex: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    const text = tokens[index]?.text;
    if (text === open) {
      depth += 1;
    } else if (text === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/** 找到与 `closeIndex` 处右括号配对的左括号下标；找不到返回 -1。 */
function matchOpen(
  tokens: readonly ICppToken[],
  closeIndex: number,
  open: string,
  close: string,
): number {
  let depth = 1;
  for (let index = closeIndex - 1; index >= 0; index -= 1) {
    const text = tokens[index]?.text;
    if (text === close) {
      depth += 1;
    } else if (text === open) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/** `index` 之前最近一层还没有闭合的 `{` 下标；找不到返回 -1。 */
function lastOpenBraceBefore(tokens: readonly ICppToken[], index: number): number {
  let pending = 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const text = tokens[cursor]?.text;
    if (text === '}') {
      pending += 1;
    } else if (text === '{') {
      if (pending === 0) {
        return cursor;
      }
      pending -= 1;
    }
  }
  return -1;
}

/** 该 `{` 是初始化列表 / lambda 体一类的内容，不是语句块，不参与块风格投票。 */
function isInlineOpening(tokens: readonly ICppToken[], index: number): boolean {
  const previous = tokens[index - 1];
  if (previous === undefined) {
    return true;
  }
  if (['=', '(', ',', '{', '[', '<'].includes(previous.text) || previous.text === 'return') {
    return true;
  }
  if (previous.text === ')') {
    const open = matchOpen(tokens, index - 1, '(', ')');
    return open > 0 && tokens[open - 1]?.text === ']';
  }
  return false;
}

/** 该运算符文本属于哪个空格开关；不是二元运算符时返回 undefined。 */
export function operatorStyleGroup(text: string): BooleanStyleKey | undefined {
  for (const [key, operators] of OPERATOR_GROUPS) {
    if (operators.includes(text)) {
      return key;
    }
  }
  return undefined;
}

/** 同一行上两个 token 之间的空白宽度；跨行或缺失时返回 undefined。 */
function gapBetween(a: ICppToken | undefined, b: ICppToken | undefined): number | undefined {
  if (a === undefined || b === undefined || a.line !== b.line) {
    return undefined;
  }
  return b.column - (a.column + a.text.length);
}

function tokenEndLine(token: ICppToken): number {
  return token.line + (token.text.match(/\n/g)?.length ?? 0);
}

class Votes {
  private readonly counts = new Map<BooleanStyleKey, IStyleEvidence>();

  record(key: BooleanStyleKey, positive: boolean): void {
    const current = this.counts.get(key) ?? { key, no: 0, yes: 0 };
    this.counts.set(
      key,
      positive ? { ...current, yes: current.yes + 1 } : { ...current, no: current.no + 1 },
    );
  }

  /** 多数派：正反例都算数时使用（空格、花括号位置）。 */
  decide(key: BooleanStyleKey, fallback: boolean): boolean {
    const entry = this.counts.get(key);
    if (entry === undefined || entry.yes === entry.no) {
      return fallback;
    }
    return entry.yes > entry.no;
  }

  /** 出现过即算数：紧凑写法出现一次就说明用户接受它，成串的换行只是那段本来就长。 */
  decidePresence(key: BooleanStyleKey, fallback: boolean): boolean {
    const entry = this.counts.get(key);
    if (entry === undefined || entry.yes + entry.no === 0) {
      return fallback;
    }
    return entry.yes > 0;
  }

  list(): readonly IStyleEvidence[] {
    return [...this.counts.values()].sort((left, right) => left.key.localeCompare(right.key));
  }
}

/** `;` 之后是否紧跟同一行的另一条语句。 */
function recordStatementSpacing(
  tokens: readonly ICppToken[],
  votes: Votes,
  parenDepthAt: (index: number) => number,
): void {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as ICppToken;
    if (token.kind !== 'punct' || token.text !== ';' || parenDepthAt(index) > 0) {
      continue;
    }
    const next = tokens[index + 1];
    if (next === undefined || ['}', ')', ';', ','].includes(next.text)) {
      continue;
    }
    votes.record('allowMultipleStatementsPerLine', next.line === tokenEndLine(token));
  }
}

/** 短语句块是否整块写在同一行。 */
function recordBlockSpacing(tokens: readonly ICppToken[], votes: Votes): void {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as ICppToken;
    if (token.kind !== 'punct' || token.text !== '{' || isInlineOpening(tokens, index)) {
      continue;
    }
    const close = matchClose(tokens, index, '{', '}');
    if (close < 0 || close - index - 1 > SHORT_BLOCK_TOKENS) {
      continue;
    }
    votes.record('allowShortBlocksOnOneLine', tokens[close]?.line === token.line);
  }
}

/** `case` 标签相对 `switch` 是否多缩进一层。 */
function recordCaseIndentation(tokens: readonly ICppToken[], votes: Votes): void {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as ICppToken;
    if (token.kind !== 'keyword' || (token.text !== 'case' && token.text !== 'default')) {
      continue;
    }
    const brace = lastOpenBraceBefore(tokens, index);
    if (brace < 0 || isInlineOpening(tokens, brace) || tokens[brace - 1]?.text !== ')') {
      continue;
    }
    const open = matchOpen(tokens, brace - 1, '(', ')');
    const header = open > 0 ? tokens[open - 1] : undefined;
    if (header?.text !== 'switch') {
      continue;
    }
    votes.record('indentCaseLabels', token.column > header.column);
  }
}

/** 三目运算符 `?` 两侧留不留空格。 */
function recordConditionalSpacing(
  tokens: readonly ICppToken[],
  votes: Votes,
  templates: ReadonlySet<number>,
): void {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as ICppToken;
    if (token.text !== '?' || templates.has(index) || !endsWithValue(tokens[index - 1])) {
      continue;
    }
    const before = gapBetween(tokens[index - 1], token);
    if (before !== undefined) {
      votes.record('spaceAroundConditional', before > 0);
    }
    const after = gapBetween(token, tokens[index + 1]);
    if (after !== undefined) {
      votes.record('spaceAroundConditional', after > 0);
    }
  }
}

/** 遍历 token，累计每个风格开关的正反例。 */
function collectVotes(tokens: readonly ICppToken[]): Votes {
  const votes = new Votes();
  const templates = templateArgumentRanges(tokens);
  // 预扫一遍圆括号深度，用来跳过 for 头里的分号
  const depths: number[] = new Array<number>(tokens.length).fill(0);
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const text = tokens[index]?.text;
    if (text === '(') {
      depth += 1;
    } else if (text === ')') {
      depth = Math.max(0, depth - 1);
    }
    depths[index] = text === '(' ? depth - 1 : depth;
  }
  recordStatementSpacing(tokens, votes, (index) => depths[index] ?? 0);
  recordBlockSpacing(tokens, votes);
  recordCaseIndentation(tokens, votes);
  recordConditionalSpacing(tokens, votes, templates);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as ICppToken;
    const next = tokens[index + 1];
    const previous = tokens[index - 1];
    if (token.kind === 'keyword' && CPP_CONTROL_KEYWORDS.has(token.text) && next?.text === '(') {
      const gap = gapBetween(token, next);
      if (gap !== undefined) {
        votes.record('spaceAfterControlKeyword', gap > 0);
      }
      const close = matchClose(tokens, index + 1, '(', ')');
      if (close > 0) {
        const afterOpen = gapBetween(next, tokens[index + 2]);
        if (afterOpen !== undefined) {
          votes.record('spaceInsideParens', afterOpen > 0);
        }
        const beforeClose = gapBetween(tokens[close - 1], tokens[close]);
        if (beforeClose !== undefined) {
          votes.record('spaceInsideParens', beforeClose > 0);
        }
        for (let inner = index + 2; inner < close; inner += 1) {
          if (tokens[inner]?.text === ';') {
            const after = gapBetween(tokens[inner], tokens[inner + 1]);
            if (after !== undefined) {
              votes.record('spaceAfterSemicolon', after > 0);
            }
          }
        }
        const body = tokens[close + 1];
        if (body !== undefined && body.text !== '{' && body.text !== ';') {
          votes.record('singleStatementOnSameLine', body.line === tokens[close]?.line);
        }
      }
      continue;
    }
    if (token.text === '{' && previous !== undefined && previous.text !== '=') {
      votes.record('braceNextLine', token.line !== previous.line);
      const gap = gapBetween(previous, token);
      if (gap !== undefined && token.line === previous.line) {
        votes.record('spaceBeforeBrace', gap > 0);
      }
      continue;
    }
    if (token.text === '}' && next?.text === 'else') {
      votes.record('elseSameLine', next.line === token.line);
      const gap = gapBetween(token, next);
      if (gap !== undefined) {
        votes.record('spaceBeforeElse', gap > 0);
      }
      continue;
    }
    if (token.text === ',') {
      const gap = gapBetween(token, next);
      if (gap !== undefined) {
        votes.record('spaceAfterComma', gap > 0);
      } else if (next !== undefined) {
        votes.record('spaceAfterComma', true);
      }
      continue;
    }
    if (token.text === '*' || token.text === '&') {
      // 只在确实是声明符时投票：`int* p` 与 `scanf("%d",&n)` 里的 `&` 不是一回事
      if (isDeclaratorAt(tokens, index)) {
        const before = gapBetween(previous, token);
        if (before !== undefined) {
          votes.record('attachPointerToType', before === 0);
        }
      }
      continue;
    }
    if (token.kind !== 'punct') {
      continue;
    }
    const group = operatorStyleGroup(token.text);
    if (
      group === undefined ||
      !endsWithValue(previous) ||
      next === undefined ||
      [')', ']', ';', ',', '}', '('].includes(next.text) ||
      templates.has(index)
    ) {
      continue;
    }
    const before = gapBetween(previous, token);
    if (before !== undefined) {
      votes.record(group, before > 0);
    }
    const after = gapBetween(token, next);
    if (after !== undefined) {
      votes.record(group, after > 0);
    }
  }
  return votes;
}

/** 统计缩进：Tab 缩进行的数量与各种空格缩进宽度。 */
function scanIndentation(source: string): {
  readonly spaceCounts: readonly number[];
  readonly tabLines: number;
} {
  const spaceCounts: number[] = [];
  let tabLines = 0;
  let insideBlockComment = false;
  for (const line of source.split(/\r?\n/)) {
    if (insideBlockComment) {
      insideBlockComment = !line.includes('*/');
      continue;
    }
    if (line.trim().length === 0) {
      continue;
    }
    const leading = /^[ \t]*/.exec(line)?.[0] ?? '';
    if (leading.includes('\t')) {
      tabLines += 1;
    } else if (leading.length > 0) {
      spaceCounts.push(leading.length);
    }
    insideBlockComment = line.includes('/*') && !line.includes('*/');
  }
  return { spaceCounts, tabLines };
}

/** 从观察到的缩进列里挑最能解释全部样本的宽度。 */
function pickIndentWidth(counts: readonly number[]): number {
  if (counts.length === 0) {
    return DEFAULT_CPP_STYLE.indentWidth;
  }
  let best = DEFAULT_CPP_STYLE.indentWidth;
  let bestScore = -1;
  for (const candidate of [2, 3, 4, 8]) {
    const score = counts.filter((count) => count % candidate === 0).length / counts.length;
    if (score >= bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function scanBlankLines(source: string): number {
  let run = 0;
  let max = 0;
  for (const line of source.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      run += 1;
      max = Math.max(max, run);
    } else {
      run = 0;
    }
  }
  return max;
}

/**
 * 从用户样本代码推断风格。
 * @param source 用户自己的代码（越典型越准）
 */
export function analyzeCppStyle(source: string): IStyleAnalysis {
  const body = source.replace(/^\uFEFF/, '');
  const tokens = tokenizeCpp(body);
  const votes = collectVotes(tokens);
  const indentation = scanIndentation(body);
  const blankRun = scanBlankLines(body);
  const indentWithTabs = indentation.tabLines > 0;
  const style: ICppStyle = {
    allowMultipleStatementsPerLine: votes.decidePresence(
      'allowMultipleStatementsPerLine',
      DEFAULT_CPP_STYLE.allowMultipleStatementsPerLine,
    ),
    allowShortBlocksOnOneLine: votes.decidePresence(
      'allowShortBlocksOnOneLine',
      DEFAULT_CPP_STYLE.allowShortBlocksOnOneLine,
    ),
    attachPointerToType: votes.decide('attachPointerToType', DEFAULT_CPP_STYLE.attachPointerToType),
    braceNextLine: votes.decide('braceNextLine', DEFAULT_CPP_STYLE.braceNextLine),
    elseSameLine: votes.decide('elseSameLine', DEFAULT_CPP_STYLE.elseSameLine),
    indentCaseLabels: votes.decide('indentCaseLabels', DEFAULT_CPP_STYLE.indentCaseLabels),
    indentWidth: indentWithTabs
      ? DEFAULT_CPP_STYLE.indentWidth
      : pickIndentWidth(indentation.spaceCounts),
    indentWithTabs,
    maxBlankLines: blankRun > 0 ? Math.min(4, blankRun) : DEFAULT_CPP_STYLE.maxBlankLines,
    singleStatementOnSameLine: votes.decide(
      'singleStatementOnSameLine',
      DEFAULT_CPP_STYLE.singleStatementOnSameLine,
    ),
    spaceAfterComma: votes.decide('spaceAfterComma', DEFAULT_CPP_STYLE.spaceAfterComma),
    spaceAfterControlKeyword: votes.decide(
      'spaceAfterControlKeyword',
      DEFAULT_CPP_STYLE.spaceAfterControlKeyword,
    ),
    spaceAfterSemicolon: votes.decide('spaceAfterSemicolon', DEFAULT_CPP_STYLE.spaceAfterSemicolon),
    spaceAroundArithmetic: votes.decide(
      'spaceAroundArithmetic',
      DEFAULT_CPP_STYLE.spaceAroundArithmetic,
    ),
    spaceAroundAssignment: votes.decide(
      'spaceAroundAssignment',
      DEFAULT_CPP_STYLE.spaceAroundAssignment,
    ),
    spaceAroundBitwise: votes.decide('spaceAroundBitwise', DEFAULT_CPP_STYLE.spaceAroundBitwise),
    spaceAroundComparison: votes.decide(
      'spaceAroundComparison',
      DEFAULT_CPP_STYLE.spaceAroundComparison,
    ),
    spaceAroundConditional: votes.decide(
      'spaceAroundConditional',
      DEFAULT_CPP_STYLE.spaceAroundConditional,
    ),
    spaceAroundLeftShift: votes.decide(
      'spaceAroundLeftShift',
      DEFAULT_CPP_STYLE.spaceAroundLeftShift,
    ),
    spaceAroundLogical: votes.decide('spaceAroundLogical', DEFAULT_CPP_STYLE.spaceAroundLogical),
    spaceAroundRightShift: votes.decide(
      'spaceAroundRightShift',
      DEFAULT_CPP_STYLE.spaceAroundRightShift,
    ),
    spaceBeforeBrace: votes.decide('spaceBeforeBrace', DEFAULT_CPP_STYLE.spaceBeforeBrace),
    spaceBeforeElse: votes.decide('spaceBeforeElse', DEFAULT_CPP_STYLE.spaceBeforeElse),
    spaceInsideParens: votes.decide('spaceInsideParens', DEFAULT_CPP_STYLE.spaceInsideParens),
  };
  const evidence = votes.list();
  let weight = 0;
  let score = 0;
  for (const entry of evidence) {
    const total = entry.yes + entry.no;
    if (total === 0) {
      continue;
    }
    const itemWeight = Math.min(total, 5) / 5;
    weight += itemWeight;
    score += itemWeight * (Math.abs(entry.yes - entry.no) / total);
  }
  const indentationEvidence = indentation.spaceCounts.length + indentation.tabLines;
  const indentationWeight = indentationEvidence > 0 ? 1 : 0;
  const confidence = (score + indentationWeight) / Math.max(1, weight + indentationWeight);
  return {
    confidence: Math.min(1, confidence),
    evidence,
    indentedLines: indentationEvidence,
    style,
  };
}
