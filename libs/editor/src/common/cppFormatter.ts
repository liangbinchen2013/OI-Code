/**
 * 按 {@link ICppStyle} 重排 C++ 代码。
 *
 * 设计取向：只做"安全且看得见"的排版——调整缩进、空白、花括号与单语句体的位置，
 * 绝不增删花括号、不合并或拆散语句、不动字符串/注释/预处理行的内容。
 * 结构可疑（括号不配对）时整段原样返回，而不是输出坏代码。
 */
import { CPP_CONTROL_KEYWORDS, tokenizeCpp, type ICppToken } from './cppLexer';
import type { ICppStyle } from './cppStyle';

export interface IFormatOutcome {
  readonly formatted: string;
  readonly changed: boolean;
  /** 结构可疑而没有改动时为 true。 */
  readonly skipped: boolean;
  readonly reason?: string;
}

interface IOutLine {
  readonly blanks: number;
  readonly level: number;
  /** 属于该行的 token 下标 */
  readonly tokens: readonly number[];
}

interface ISpaceContext {
  readonly afterUnary: boolean;
  readonly beforeUnary: boolean;
  readonly declarator: boolean;
  readonly inTemplate: boolean;
}

/** 模板实参里允许出现的 token，用来区分 `vector<int>` 与 `a < b`。 */
const TEMPLATE_ALLOWED = /^(?:[A-Za-z_]\w*|\d[\w'']*|::|,|\*|&|\[|\]|<|>|>>|<<|\.)$/;

const TYPE_LIKE_BEFORE_ANGLE = /[A-Za-z_0-9>]$/;

const BINARY_SYMBOLS: ReadonlySet<string> = new Set([
  '+',
  '-',
  '*',
  '/',
  '%',
  '=',
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
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '->',
]);

/** 既可一元也可二元的运算符，靠前一个 token 判方向。 */
const UNARY_CAPABLE: ReadonlySet<string> = new Set(['*', '&', '+', '-', '!', '~']);

const VALUE_ENDING_KINDS: ReadonlySet<string> = new Set([
  'identifier',
  'number',
  'string',
  'character',
]);

function isControlKeyword(token: ICppToken | undefined): boolean {
  return token !== undefined && token.kind === 'keyword' && CPP_CONTROL_KEYWORDS.has(token.text);
}

/** 与 `closeIndex` 处右括号配对的左括号前面是不是控制关键字。 */
function isControlHeader(tokens: readonly ICppToken[], closeIndex: number): boolean {
  let depth = 1;
  for (let index = closeIndex - 1; index >= 0; index -= 1) {
    const text = tokens[index]?.text;
    if (text === ')') {
      depth += 1;
    } else if (text === '(') {
      depth -= 1;
      if (depth === 0) {
        return isControlKeyword(tokens[index - 1]);
      }
    }
  }
  return false;
}

/** 从 `<` 起找配对的 `>`；不像模板实参时返回 -1。 */
function templateSpanEnd(tokens: readonly ICppToken[], start: number): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index] as ICppToken;
    if (token.text === '<') {
      depth += 1;
    } else if (token.text === '<<') {
      depth += 2;
    } else if (token.text === '>') {
      depth -= 1;
    } else if (token.text === '>>') {
      depth -= 2;
    } else if (!TEMPLATE_ALLOWED.test(token.text)) {
      return -1;
    }
    if (depth <= 0) {
      return index === start ? -1 : index;
    }
  }
  return -1;
}

/** 标出所有模板实参区间的 token 下标，排版时 `<`/`>` 两侧不留空格。 */
function templateRanges(tokens: readonly ICppToken[]): Set<number> {
  const marks = new Set<number>();
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.text !== '<' || marks.has(index)) {
      continue;
    }
    const previous = tokens[index - 1];
    if (previous === undefined || !TYPE_LIKE_BEFORE_ANGLE.test(previous.text)) {
      continue;
    }
    const end = templateSpanEnd(tokens, index);
    if (end < 0) {
      continue;
    }
    for (let inner = index; inner <= end; inner += 1) {
      marks.add(inner);
    }
    index = end;
  }
  return marks;
}

function endsWithValue(token: ICppToken | undefined): boolean {
  if (token === undefined) {
    return false;
  }
  if (VALUE_ENDING_KINDS.has(token.kind)) {
    return true;
  }
  if (token.kind === 'keyword') {
    return ['nullptr', 'this', 'true', 'false'].includes(token.text);
  }
  return [')', ']', '++', '--'].includes(token.text);
}

/** 预计算哪些位置上的运算符是一元的（`-x`、`*p`、`!flag`）。 */
function unaryIndices(tokens: readonly ICppToken[]): Set<number> {
  const marks = new Set<number>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as ICppToken;
    if (
      token.kind === 'punct' &&
      UNARY_CAPABLE.has(token.text) &&
      !endsWithValue(tokens[index - 1])
    ) {
      marks.add(index);
    }
  }
  return marks;
}

/** 语句或声明的起始位置：`Node& x` 的类型名前面就是这些。 */
function isStatementBoundary(token: ICppToken | undefined): boolean {
  if (token === undefined) {
    return true;
  }
  if (
    token.kind === 'preprocessor' ||
    token.kind === 'lineComment' ||
    token.kind === 'blockComment'
  ) {
    return true;
  }
  return [';', '{', '}', '(', ',', '=', ':', 'return', 'case'].includes(token.text);
}

/** 下标处的 `*` / `&` 是声明符（`int *p`）还是运算符（`a * b`）。 */
function isDeclaratorAt(tokens: readonly ICppToken[], index: number): boolean {
  const token = tokens[index];
  if (token === undefined || !['*', '&'].includes(token.text)) {
    return false;
  }
  const previous = tokens[index - 1];
  const next = tokens[index + 1];
  if (previous === undefined || next === undefined) {
    return false;
  }
  if (next.kind !== 'identifier' && !['(', '['].includes(next.text)) {
    return false;
  }
  if (previous.kind === 'keyword' || ['>', '*', '&', ','].includes(previous.text)) {
    return true;
  }
  if (previous.kind !== 'identifier') {
    return false;
  }
  // `Node& x` 出现在语句开头；`a * b` 的 `a` 前面已经在表达式里
  return isStatementBoundary(tokens[index - 2]) || tokens[index - 2]?.kind === 'keyword';
}

/** 同一行上相邻两个 token 之间要不要空格。 */
function needsSpace(
  before: ICppToken,
  after: ICppToken,
  style: ICppStyle,
  context: ISpaceContext,
): boolean {
  const text = after.text;
  if ([',', ';', ')', ']', '.', '->', ':'].includes(text)) {
    return false;
  }
  if (['(', '[', '.', '->', '::', ':'].includes(before.text)) {
    return false;
  }
  if (text === '{') {
    return style.spaceBeforeBrace;
  }
  if (text === '(' && isControlKeyword(before)) {
    return style.spaceAfterControlKeyword;
  }
  if (text === '(') {
    return !(
      before.kind === 'identifier' ||
      [')', ']'].includes(before.text) ||
      before.kind === 'string' ||
      before.kind === 'character'
    );
  }
  if (context.inTemplate) {
    if (before.text === ',') {
      return style.spaceAfterComma;
    }
    if (['<', '<<'].includes(text) || ['<', '<<', '::'].includes(before.text)) {
      return false;
    }
    return !['>', '>>'].includes(text);
  }
  if (context.declarator) {
    return text === '*' || text === '&' ? !style.attachPointerToType : style.attachPointerToType;
  }
  if (context.beforeUnary) {
    // 前缀运算符紧贴操作数：`-x`、`*p`、`&v`
    return false;
  }
  if (BINARY_SYMBOLS.has(text) || BINARY_SYMBOLS.has(before.text)) {
    if (context.afterUnary) {
      return BINARY_SYMBOLS.has(before.text) ? style.spaceAroundBinaryOperator : true;
    }
    return style.spaceAroundBinaryOperator;
  }
  if (before.text === ',') {
    return style.spaceAfterComma;
  }
  if (before.text === ';') {
    return style.spaceAfterSemicolon;
  }
  return true;
}

/** 括号是否配对；不配对时拒绝格式化。 */
function isBalanced(tokens: readonly ICppToken[]): boolean {
  const closing: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const stack: string[] = [];
  for (const token of tokens) {
    if (['lineComment', 'blockComment', 'preprocessor'].includes(token.kind)) {
      continue;
    }
    if (['(', '[', '{'].includes(token.text)) {
      stack.push(token.text);
    } else if ([')', ']', '}'].includes(token.text)) {
      if (stack.pop() !== closing[token.text]) {
        return false;
      }
    }
  }
  return stack.length === 0;
}

function tokenEndLine(token: ICppToken): number {
  return token.line + (token.text.match(/\n/g)?.length ?? 0);
}

/** 与 `closeIndex` 处右括号配对的左括号下标；找不到返回 -1。 */
function matchingOpen(
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

/** 该 `{` 是否属于"不断行"区域（初始化列表、lambda 体、聚合赋值等）。 */
function isInlineBrace(tokens: readonly ICppToken[], index: number): boolean {
  const previous = tokens[index - 1];
  if (previous === undefined) {
    return true;
  }
  if (['=', '(', ',', '{', '['].includes(previous.text) || previous.text === 'return') {
    return true;
  }
  if (previous.text === ')') {
    // `](int a){...}` 的 lambda 参数表之后按内联处理；函数头与控制流头之后是语句块
    const open = matchingOpen(tokens, index - 1, '(', ')');
    return open > 0 && tokens[open - 1]?.text === ']';
  }
  return false;
}

/** 该花括号是不是 switch 语句的块（决定 case 是否少缩进一层）。 */
function isSwitchBlockBrace(tokens: readonly ICppToken[], index: number): boolean {
  const previous = tokens[index - 1];
  if (previous?.text !== ')') {
    return false;
  }
  const open = matchingOpen(tokens, index - 1, '(', ')');
  return open > 0 && tokens[open - 1]?.text === 'switch';
}

/**
 * 按风格重排 C++ 源码。
 * @param source 原始代码
 * @param style 目标风格（通常来自 {@link analyzeCppStyle}）
 */
export function formatCpp(source: string, style: ICppStyle): IFormatOutcome {
  const tokens = tokenizeCpp(source);
  if (tokens.length === 0) {
    return { changed: false, formatted: source, skipped: false };
  }
  if (!isBalanced(tokens)) {
    return { changed: false, formatted: source, reason: '括号不配对，已保持原样', skipped: true };
  }
  const template = templateRanges(tokens);
  const unary = unaryIndices(tokens);
  const lines: IOutLine[] = [];
  /** 已打开的块是否为 switch 体 */
  const blocks: boolean[] = [];
  let level = 0;
  let inlineDepth = 0;
  let singleBodyExtra = 0;
  let caseBodyExtra = 0;
  let breakNext = false;
  let current: number[] = [];
  let currentLevel = 0;
  let pendingBlanks = 0;
  let previous: ICppToken | undefined;

  const flush = (nextLevel: number, blanks: number): void => {
    if (current.length > 0) {
      lines.push({ blanks: pendingBlanks, level: currentLevel, tokens: current });
    }
    current = [];
    currentLevel = Math.max(0, nextLevel);
    pendingBlanks = Math.max(0, blanks);
  };
  const isCaseLabel = (token: ICppToken): boolean =>
    (token.text === 'case' || token.text === 'default') && blocks[blocks.length - 1] === true;
  /** case 标签本身与 switch 体同层，标签下的语句多缩进一层。 */
  const levelFor = (token: ICppToken): number =>
    isCaseLabel(token) ? level : level + singleBodyExtra + caseBodyExtra;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as ICppToken;
    const next = tokens[index + 1];
    const blanks =
      previous === undefined
        ? 0
        : Math.min(style.maxBlankLines, Math.max(0, token.line - tokenEndLine(previous) - 1));
    const newSourceLine = previous !== undefined && token.line > tokenEndLine(previous);
    const keepInline = inlineDepth > 0;
    const isComment = token.kind === 'lineComment' || token.kind === 'blockComment';
    const atLineStart = current.length === 0;
    const blockClose = token.text === '}' && !keepInline;
    const blockOpen = token.text === '{' && !isInlineBrace(tokens, index);

    const startNewLine =
      token.kind === 'preprocessor' ||
      blockClose ||
      (blockOpen && style.braceNextLine && !keepInline) ||
      (isComment && (newSourceLine || previous?.kind === 'lineComment')) ||
      (isCaseLabel(token) && atLineStart) ||
      (token.text === 'else' && !style.elseSameLine && !atLineStart) ||
      (newSourceLine && keepInline) ||
      (breakNext && !atLineStart && !isComment && !',;)'.includes(token.text));

    if (blockClose) {
      level = Math.max(0, level - 1);
      blocks.pop();
      singleBodyExtra = 0;
    }
    if (startNewLine) {
      flush(levelFor(token), blanks);
    } else if (atLineStart) {
      currentLevel = levelFor(token);
    }
    current.push(index);
    breakNext = false;

    if (token.kind === 'preprocessor') {
      breakNext = true;
    } else if (isCaseLabel(token) && current.length === 1) {
      caseBodyExtra = 0;
    } else if (token.text === ':' && blocks[blocks.length - 1] === true && !keepInline) {
      // case/default 标签：冒号结束标签行，其下语句多缩进一层
      caseBodyExtra = 1;
      breakNext = true;
    } else if (token.text === '{') {
      if (isInlineBrace(tokens, index)) {
        inlineDepth += 1;
      } else {
        level += 1;
        blocks.push(isSwitchBlockBrace(tokens, index));
        caseBodyExtra = 0;
        flush(level, 0);
      }
    } else if (token.text === ';' && !keepInline) {
      singleBodyExtra = 0;
      breakNext = true;
    } else if (token.kind === 'lineComment') {
      breakNext = true;
    } else if (
      token.text === ')' &&
      !keepInline &&
      isControlHeader(tokens, index) &&
      next !== undefined &&
      next.text !== '{' &&
      next.text !== ';' &&
      next.kind !== 'preprocessor'
    ) {
      if (style.singleStatementOnSameLine) {
        singleBodyExtra = 0;
      } else {
        singleBodyExtra = 1;
        breakNext = true;
      }
    }
    previous = token;
  }
  flush(0, 0);

  const indentOf = (value: number): string =>
    value === 0
      ? ''
      : style.indentWithTabs
        ? '\t'.repeat(value)
        : ' '.repeat(value * style.indentWidth);

  const assembled: string[] = [];
  for (let position = 0; position < lines.length; position += 1) {
    const line = lines[position] as IOutLine;
    if (position > 0) {
      for (let blank = 0; blank < line.blanks; blank += 1) {
        assembled.push('');
      }
    }
    let text = indentOf(line.level);
    for (let offset = 0; offset < line.tokens.length; offset += 1) {
      const tokenIndex = line.tokens[offset] as number;
      const token = tokens[tokenIndex] as ICppToken;
      if (offset === 0) {
        text += token.text;
        continue;
      }
      const beforeIndex = line.tokens[offset - 1] as number;
      const before = tokens[beforeIndex] as ICppToken;
      const comment = token.kind === 'lineComment' || token.kind === 'blockComment';
      const space = comment
        ? true
        : needsSpace(before, token, style, {
            afterUnary: unary.has(tokenIndex),
            beforeUnary: unary.has(beforeIndex),
            declarator: isDeclaratorAt(tokens, tokenIndex) || isDeclaratorAt(tokens, beforeIndex),
            inTemplate: template.has(tokenIndex) || template.has(beforeIndex),
          });
      text += `${space ? ' ' : ''}${token.text}`;
    }
    assembled.push(text.trimEnd());
  }
  const formatted = `${assembled.join('\n')}${source.endsWith('\n') ? '\n' : ''}`;
  return { changed: formatted !== source, formatted, skipped: false };
}
