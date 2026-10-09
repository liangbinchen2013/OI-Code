/**
 * C++ 代码风格模型与"从用户样本反推风格"的分析器。
 *
 * 目标不是通用 clang-format 的替身，而是把 OIer 真正在意的少数几个习惯
 * 量化出来：缩进、花括号位置、`if(true) continue;` 这类单语句体写法、
 * 各种语法之间的空格有无。样本不足时宁可回落默认值也不瞎猜。
 */
import { CPP_CONTROL_KEYWORDS, tokenizeCpp, type ICppToken } from './cppLexer';

export interface ICppStyle {
  /** 缩进用 Tab 而不是空格 */
  readonly indentWithTabs: boolean;
  /** 一层缩进的宽度（空格数，或一个 Tab 折算的显示宽度） */
  readonly indentWidth: number;
  /** 左花括号另起一行（Allman）而不是跟在行尾（K&R） */
  readonly braceNextLine: boolean;
  /** 单语句体与头部同行：`if (x) continue;`；否则换行缩进 */
  readonly singleStatementOnSameLine: boolean;
  /** 控制关键字与左括号之间留空格：`if (` / `if(` */
  readonly spaceAfterControlKeyword: boolean;
  /** 圆括号内侧留空格：`if( x )` */
  readonly spaceInsideParens: boolean;
  /** 二元运算符与赋值两侧留空格：`a + b` / `a+b` */
  readonly spaceAroundBinaryOperator: boolean;
  /** 逗号后留空格：`f(a, b)` / `f(a,b)` */
  readonly spaceAfterComma: boolean;
  /** for 头里分号后留空格：`for (i = 0; i < n; ++i)` */
  readonly spaceAfterSemicolon: boolean;
  /** 指针/引用符号贴类型（`int* p`）还是贴变量（`int *p`） */
  readonly attachPointerToType: boolean;
  /** `} else {` 写法；false 时 else 另起一行 */
  readonly elseSameLine: boolean;
  /** 允许保留的最大连续空行数 */
  readonly maxBlankLines: number;
}

export const DEFAULT_CPP_STYLE: ICppStyle = {
  attachPointerToType: false,
  braceNextLine: false,
  elseSameLine: true,
  indentWidth: 4,
  indentWithTabs: false,
  maxBlankLines: 2,
  singleStatementOnSameLine: false,
  spaceAfterComma: true,
  spaceAfterControlKeyword: true,
  spaceAfterSemicolon: true,
  spaceAroundBinaryOperator: true,
  spaceInsideParens: false,
};

export type BooleanStyleKey = Exclude<keyof ICppStyle, 'indentWidth' | 'maxBlankLines'>;

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
  /** 缩进统计出的行数，用于解释 indentWidth/Tab 的依据 */
  readonly indentedLines: number;
}

/** 判定为"类型名"的关键字，用于区分 `int *p` 与 `a * b`。 */
const TYPE_KEYWORDS: ReadonlySet<string> = new Set([
  'auto',
  'bool',
  'char',
  'class',
  'const',
  'decltype',
  'double',
  'float',
  'int',
  'long',
  'register',
  'short',
  'signed',
  'struct',
  'typename',
  'union',
  'unsigned',
  'void',
  'volatile',
]);

const BINARY_OPERATORS: ReadonlySet<string> = new Set([
  '+',
  '-',
  '*',
  '/',
  '%',
  '=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '==',
  '!=',
  '<',
  '>',
  '<=',
  '>=',
  '&&',
  '||',
  '&',
  '|',
  '^',
  '<<',
  '>>',
  '->',
  '.',
]);

/** 值结尾的 token：它后面的 `*`/`&`/`+`/`-` 是二元或后缀，不是声明符或一元。 */
function endsWithValue(token: ICppToken | undefined): boolean {
  if (token === undefined) {
    return false;
  }
  if (
    token.kind === 'identifier' ||
    token.kind === 'number' ||
    token.kind === 'string' ||
    token.kind === 'character'
  ) {
    return true;
  }
  if (token.kind === 'keyword') {
    return (
      token.text === 'this' ||
      token.text === 'true' ||
      token.text === 'false' ||
      token.text === 'nullptr'
    );
  }
  return token.text === ')' || token.text === ']' || token.text === '++' || token.text === '--';
}

function isDeclaratorAmpersand(tokens: readonly ICppToken[], index: number): boolean {
  const previous = tokens[index - 1];
  const next = tokens[index + 1];
  if (previous === undefined || next === undefined || next.kind !== 'identifier') {
    return false;
  }
  if (previous.kind === 'keyword' && TYPE_KEYWORDS.has(previous.text)) {
    return true;
  }
  if (
    previous.text === '>' ||
    previous.text === '*' ||
    previous.text === '&' ||
    previous.text === ','
  ) {
    return true;
  }
  const beforePrevious = tokens[index - 2];
  // `Node *p` / `vector<int> *p`：前一个标识符是类型名
  return (
    previous.kind === 'identifier' && beforePrevious !== undefined && !endsWithValue(beforePrevious)
  );
}

/** 同一行上两个 token 之间的空白宽度；跨行返回 undefined。 */
function gapBetween(a: ICppToken, b: ICppToken): number | undefined {
  if (a.line !== b.line) {
    return undefined;
  }
  return b.column - (a.column + a.text.length);
}

class Votes {
  private readonly counts = new Map<BooleanStyleKey, IStyleEvidence>();

  record(key: BooleanStyleKey, positive: boolean): void {
    const current = this.counts.get(key) ?? { key, no: 0, yes: 0 };
    const next = positive
      ? { ...current, yes: current.yes + 1 }
      : { ...current, no: current.no + 1 };
    this.counts.set(key, next);
  }

  decide(key: BooleanStyleKey, fallback: boolean): boolean {
    const entry = this.counts.get(key);
    if (entry === undefined || entry.yes + entry.no === 0) {
      return fallback;
    }
    if (entry.yes === entry.no) {
      return fallback;
    }
    return entry.yes > entry.no;
  }

  list(): readonly IStyleEvidence[] {
    return [...this.counts.values()].sort((left, right) => left.key.localeCompare(right.key));
  }
}

/** 找到与 `openIndex` 处左括号配对的右括号下标；找不到返回 -1。 */
function matchParen(
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

/** 统计缩进：返回 Tab 缩进行数与各种空格缩进宽度。 */
function scanIndentation(source: string): {
  readonly spaceCounts: readonly number[];
  readonly tabLines: number;
} {
  const spaceCounts: number[] = [];
  let tabLines = 0;
  let insideBlockComment = false;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine;
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
      continue;
    }
    if (leading.length > 0) {
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

/** 遍历 token，累计每个风格开关的正反例。 */
function collectVotes(tokens: readonly ICppToken[]): Votes {
  const votes = new Votes();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as ICppToken;
    const next = tokens[index + 1];
    const previous = tokens[index - 1];
    if (token.kind === 'keyword' && CPP_CONTROL_KEYWORDS.has(token.text) && next?.text === '(') {
      const gap = gapBetween(token, next);
      if (gap !== undefined) {
        votes.record('spaceAfterControlKeyword', gap > 0);
      }
      const close = matchParen(tokens, index + 1, '(', ')');
      if (close > 0) {
        const inner = tokens[index + 2];
        const afterOpen = gapBetween(next, inner);
        if (afterOpen !== undefined) {
          votes.record('spaceInsideParens', afterOpen > 0);
        }
        const beforeClose = gapBetween(tokens[close - 1], tokens[close]);
        if (beforeClose !== undefined) {
          votes.record('spaceInsideParens', beforeClose > 0);
        }
        for (let inner2 = index + 2; inner2 < close; inner2 += 1) {
          if (tokens[inner2]?.text === ';') {
            const after = gapBetween(tokens[inner2] as ICppToken, tokens[inner2 + 1] as ICppToken);
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
      continue;
    }
    if (token.text === '}' && next?.text === 'else') {
      votes.record('elseSameLine', next.line === token.line);
      continue;
    }
    if (token.text === ',') {
      const gap = gapBetween(token, next as ICppToken);
      if (gap !== undefined) {
        votes.record('spaceAfterComma', gap > 0);
      } else if (next !== undefined) {
        votes.record('spaceAfterComma', true);
      }
      continue;
    }
    if (
      token.kind === 'punct' &&
      BINARY_OPERATORS.has(token.text) &&
      endsWithValue(previous) &&
      next !== undefined &&
      ![';', ')', ']', ',', '}', ''].includes(next.text)
    ) {
      const before = gapBetween(previous as ICppToken, token);
      if (before !== undefined) {
        votes.record('spaceAroundBinaryOperator', before > 0);
      }
      const after = gapBetween(token, next);
      if (after !== undefined) {
        votes.record('spaceAroundBinaryOperator', after > 0);
      }
      continue;
    }
    if ((token.text === '*' || token.text === '&') && isDeclaratorAmpersand(tokens, index)) {
      const before = gapBetween(previous as ICppToken, token);
      const after = gapBetween(token, next as ICppToken);
      if (before !== undefined && after !== undefined) {
        votes.record(
          'attachPointerToType',
          before > 0 && after === 0 ? false : before === 0 && after > 0,
        );
      }
    }
  }
  return votes;
}

/**
 * 从用户样本代码推断风格。
 * @param source 用户自己的代码（越典型越准）
 */
export function analyzeCppStyle(source: string): IStyleAnalysis {
  const tokens = tokenizeCpp(source);
  const votes = collectVotes(tokens);
  const indentation = scanIndentation(source);
  const blankRun = scanBlankLines(source);
  const indentWithTabs = indentation.tabLines > 0;
  const style: ICppStyle = {
    attachPointerToType: votes.decide('attachPointerToType', DEFAULT_CPP_STYLE.attachPointerToType),
    braceNextLine: votes.decide('braceNextLine', DEFAULT_CPP_STYLE.braceNextLine),
    elseSameLine: votes.decide('elseSameLine', DEFAULT_CPP_STYLE.elseSameLine),
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
    spaceAroundBinaryOperator: votes.decide(
      'spaceAroundBinaryOperator',
      DEFAULT_CPP_STYLE.spaceAroundBinaryOperator,
    ),
    spaceInsideParens: votes.decide('spaceInsideParens', DEFAULT_CPP_STYLE.spaceInsideParens),
  };
  const evidence = votes.list();
  // 单项把握度 = 多数派占比，按证据条数加权；样本越少整体置信度越低
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
  const indentationWeight = indentation.spaceCounts.length + indentation.tabLines > 0 ? 1 : 0;
  const confidence = (score + indentationWeight) / Math.max(1, weight + indentationWeight);
  return {
    confidence: Math.min(1, confidence),
    evidence,
    indentedLines: indentation.spaceCounts.length + indentation.tabLines,
    style,
  };
}
