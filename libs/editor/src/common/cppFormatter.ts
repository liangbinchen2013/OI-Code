/**
 * 按 {@link ICppStyle} 重排 C++ 代码。
 *
 * 设计取向：只做"安全且看得见"的排版——调整缩进、空白、花括号与单语句体的位置，
 * 绝不增删花括号、不动字符串/注释/预处理行的内容。
 * "一行几句 / 整块一行"按源文件的写法保留（由 allow* 两个开关控制），
 * 因为把它们拆开同样是可见的风格改变。
 * 结构可疑（括号不配对）时整段原样返回，而不是输出坏代码。
 */
import {
  CPP_CONTROL_KEYWORDS,
  endsWithValue,
  isDeclaratorAt,
  templateArgumentRanges,
  tokenizeCpp,
  type ICppToken,
} from './cppLexer';
import { operatorStyleGroup, type ICppStyle } from './cppStyle';

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
  readonly inTernary: boolean;
  /**
   * 源文件本来就写成一行（一行多条语句、整块一行）时，
   * 这两处沿用源空格：它们记录的是用户的紧凑习惯，不是排版错误。
   */
  readonly keepSourceGap: boolean;
  readonly sourceGap: number;
}

/** 既可一元也可二元的运算符，靠前一个 token 判方向。 */
const UNARY_CAPABLE: ReadonlySet<string> = new Set(['*', '&', '+', '-', '!', '~']);

function isControlKeyword(token: ICppToken | undefined): boolean {
  return token !== undefined && token.kind === 'keyword' && CPP_CONTROL_KEYWORDS.has(token.text);
}

/** 与 `closeIndex` 处右括号配对的左括号前面是不是控制关键字。 */
function isControlHeader(tokens: readonly ICppToken[], closeIndex: number): boolean {
  const open = matchingOpen(tokens, closeIndex, '(', ')');
  return open > 0 && isControlKeyword(tokens[open - 1]);
}

function isIncrement(token: ICppToken | undefined): boolean {
  return token !== undefined && (token.text === '++' || token.text === '--');
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

/** 圆括号 / 方括号深度：`for(int i=0;i<n;i++)` 里的分号不该断行。 */
function bracketDepths(tokens: readonly ICppToken[]): number[] {
  const depths: number[] = new Array<number>(tokens.length).fill(0);
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const text = tokens[index]?.text;
    if (text === '(' || text === '[') {
      depth += 1;
      depths[index] = depth - 1;
    } else if (text === ')' || text === ']') {
      depths[index] = depth;
      depth = Math.max(0, depth - 1);
    } else {
      depths[index] = depth;
    }
  }
  return depths;
}

/** 标出三目运算符的 `?` 与配对的 `:`，两侧的空格由 spaceAroundConditional 决定。 */
function ternaryIndices(tokens: readonly ICppToken[]): Set<number> {
  const marks = new Set<number>();
  const stack: number[] = [];
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as ICppToken;
    if (token.text === '(' || token.text === '[' || token.text === '{') {
      depth += 1;
    } else if (token.text === ')' || token.text === ']' || token.text === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (token.text === '?') {
      stack.push(depth);
      marks.add(index);
    } else if (token.text === ':' && stack.length > 0 && stack[stack.length - 1] === depth) {
      stack.pop();
      marks.add(index);
    }
  }
  return marks;
}

/** 同一行上相邻两个 token 之间要不要空格。 */
function needsSpace(
  before: ICppToken,
  after: ICppToken,
  style: ICppStyle,
  context: ISpaceContext,
): boolean {
  if (context.keepSourceGap) {
    return context.sourceGap > 0;
  }
  if (context.inTernary) {
    return style.spaceAroundConditional;
  }
  if (isIncrement(after) && endsWithValue(before)) {
    // 后缀自增自减紧贴操作数：`i++`
    return false;
  }
  if (isIncrement(before) && endsWithValue(after)) {
    // 前缀：`--j`
    return false;
  }
  if ([',', ';', ')', ']', '.', '->', ':', '::'].includes(after.text)) {
    return false;
  }
  if (['(', '[', '.', '->', '::', ':'].includes(before.text)) {
    return false;
  }
  if (after.text === '[' && endsWithValue(before)) {
    // 下标紧贴：`a[i]`、`g[u].push_back(v)`
    return false;
  }
  if (after.text === '{') {
    return style.spaceBeforeBrace;
  }
  if (after.text === '(' && isControlKeyword(before)) {
    return style.spaceAfterControlKeyword;
  }
  if (after.text === '(') {
    if (context.beforeUnary) {
      // 一元运算符后面的分组括号紧贴：`-(a+b)`、`!(x||y)`
      return false;
    }
    if (
      before.kind === 'identifier' ||
      [')', ']'].includes(before.text) ||
      before.kind === 'string' ||
      before.kind === 'character'
    ) {
      return false;
    }
    // `mid=(l+r)/2` 这类运算符后面的括号跟该运算符的空格习惯一致
    const beforeGroup = operatorStyleGroup(before.text);
    return beforeGroup === undefined ? true : style[beforeGroup];
  }
  if (after.text === 'else' && before.text === '}') {
    return style.spaceBeforeElse;
  }
  if (context.inTemplate) {
    if (before.text === ',') {
      return style.spaceAfterComma;
    }
    if (['<', '<<'].includes(after.text) || ['<', '<<', '::'].includes(before.text)) {
      return false;
    }
    return !['>', '>>'].includes(after.text);
  }
  if (context.declarator) {
    return after.text === '*' || after.text === '&'
      ? !style.attachPointerToType
      : style.attachPointerToType;
  }
  if (context.beforeUnary) {
    // 前缀运算符紧贴操作数：`-x`、`*p`、`&v`
    return false;
  }
  if (context.afterUnary) {
    // `&n`、`*p`、`-x` 是一元用法：它自己不计入二元运算符的空格习惯，
    // 只跟着前一个 token 的习惯走。
    if (before.text === ',') {
      return style.spaceAfterComma;
    }
    if (before.text === ';') {
      return style.spaceAfterSemicolon;
    }
    const beforeGroup = operatorStyleGroup(before.text);
    return beforeGroup === undefined ? true : style[beforeGroup];
  }
  const group = operatorStyleGroup(after.text) ?? operatorStyleGroup(before.text);
  if (group !== undefined) {
    return style[group];
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

/** 该 `{` 结构上属于"不断行"区域（初始化列表、lambda 体、聚合赋值等）。 */
function isStructuralInlineBrace(tokens: readonly ICppToken[], index: number): boolean {
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

/** 语句块的种类：switch 体要处理 case，do 体的 `} while` 跟着本行。 */
type BlockKind = 'switch' | 'do' | 'plain';

/** 该花括号是不是 switch 语句的块（决定 case 是否少缩进一层）。 */
function isSwitchBlockBrace(tokens: readonly ICppToken[], index: number): boolean {
  const previous = tokens[index - 1];
  if (previous?.text !== ')') {
    return false;
  }
  const open = matchingOpen(tokens, index - 1, '(', ')');
  return open > 0 && tokens[open - 1]?.text === 'switch';
}

/** 该花括号是不是 do-while 的循环体（`do { ... } while (x);`）。 */
function isDoBlockBrace(tokens: readonly ICppToken[], index: number): boolean {
  return tokens[index - 1]?.text === 'do';
}

/**
 * 给每个花括号定性与配对关系：`inline` 表示整块留在源行上，不断行；
 * `block` 表示语句块，进出各占一行。`kept` 记录"因为源文件就写成一行而保留"的块。
 */
function classifyBraces(
  tokens: readonly ICppToken[],
  style: ICppStyle,
): {
  readonly kinds: Map<number, 'inline' | 'block'>;
  readonly openOfClose: Map<number, number>;
  readonly kept: ReadonlySet<number>;
} {
  const kinds = new Map<number, 'inline' | 'block'>();
  const openOfClose = new Map<number, number>();
  const kept = new Set<number>();
  const stack: number[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as ICppToken;
    if (token.kind !== 'punct') {
      continue;
    }
    if (token.text === '{') {
      let kind: 'inline' | 'block' = isStructuralInlineBrace(tokens, index) ? 'inline' : 'block';
      if (kind === 'block' && style.allowShortBlocksOnOneLine) {
        const close = matchingCloseOfBrace(tokens, index);
        if (close !== undefined && tokens[close]?.line === token.line) {
          kind = 'inline';
          kept.add(index);
        }
      }
      kinds.set(index, kind);
      stack.push(index);
    } else if (token.text === '}') {
      const open = stack.pop();
      if (open !== undefined) {
        openOfClose.set(index, open);
      }
    }
  }
  return { kept, kinds, openOfClose };
}

/** 与 `openIndex` 处 `{` 配对的 `}` 下标；不配对时返回 undefined。 */
function matchingCloseOfBrace(tokens: readonly ICppToken[], openIndex: number): number | undefined {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    const text = tokens[index]?.text;
    if (text === '{') {
      depth += 1;
    } else if (text === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return undefined;
}

/**
 * 按风格重排 C++ 源码。
 * @param source 原始代码
 * @param style 目标风格（通常来自 {@link analyzeCppStyle}）
 */
export function formatCpp(source: string, style: ICppStyle): IFormatOutcome {
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = bom === '' ? source : source.slice(1);
  const tokens = tokenizeCpp(body);
  if (tokens.length === 0) {
    return { changed: false, formatted: source, skipped: false };
  }
  if (!isBalanced(tokens)) {
    return { changed: false, formatted: source, reason: '括号不配对，已保持原样', skipped: true };
  }
  const template = templateArgumentRanges(tokens);
  const ternary = ternaryIndices(tokens);
  const unary = unaryIndices(tokens);
  const depths = bracketDepths(tokens);
  const braces = classifyBraces(tokens, style);
  const lines: IOutLine[] = [];
  /** 已打开的块类型：switch 体要处理 case，do 体的 `} while` 不断行 */
  const blocks: BlockKind[] = [];
  let level = 0;
  let inlineDepth = 0;
  let singleBodyExtra = 0;
  let caseBodyExtra = 0;
  let breakNext = false;
  /** 本轮刚关闭的语句块类型，用于 `} while` 不断行 */
  let closingKind: BlockKind | undefined;
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
    (token.text === 'case' || token.text === 'default') && blocks[blocks.length - 1] === 'switch';
  /** case 标签的缩进层：可开关控制它是否与块内语句同层。 */
  const levelFor = (token: ICppToken): number =>
    isCaseLabel(token)
      ? style.indentCaseLabels
        ? level
        : level - 1
      : level + singleBodyExtra + caseBodyExtra;

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
    const openForThisClose = token.text === '}' ? braces.openOfClose.get(index) : undefined;
    const closesInline =
      openForThisClose !== undefined && braces.kinds.get(openForThisClose) === 'inline';
    const blockClose = token.text === '}' && !closesInline;
    const blockOpen = token.text === '{' && braces.kinds.get(index) === 'block';
    closingKind = undefined;

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
      closingKind = blocks.pop();
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
    } else if (token.text === ':' && blocks[blocks.length - 1] === 'switch' && !keepInline) {
      // case/default 标签：冒号结束标签行，其下语句按开关决定是否多缩进一层
      caseBodyExtra = style.indentCaseLabels ? 1 : 0;
      breakNext = true;
    } else if (token.text === '{') {
      if (braces.kinds.get(index) === 'inline') {
        inlineDepth += 1;
      } else {
        level += 1;
        blocks.push(
          isSwitchBlockBrace(tokens, index)
            ? 'switch'
            : isDoBlockBrace(tokens, index)
              ? 'do'
              : 'plain',
        );
        caseBodyExtra = 0;
        flush(level, 0);
      }
    } else if (token.text === '}') {
      if (closesInline) {
        if (inlineDepth > 0) {
          inlineDepth -= 1;
        }
        // 整块留在一行时，源文件里另起一行的下一条语句仍然换行
        breakNext = next !== undefined && next.line > tokenEndLine(token) && next.text !== 'else';
      } else {
        // 语句块结束后下一条语句另起一行；`} else` 与 do-while 的 `} while` 跟着本行
        const keepsLine =
          next !== undefined &&
          ((next.text === 'else' && style.elseSameLine) ||
            (closingKind === 'do' && next.text === 'while'));
        breakNext = !keepsLine;
      }
    } else if (token.text === ';' && !keepInline) {
      singleBodyExtra = 0;
      // 括号里的分号（for 头、数组下标）永远不断行；行内多语句按源写法保留
      const sameLineStatement =
        style.allowMultipleStatementsPerLine &&
        next !== undefined &&
        next.line === tokenEndLine(token) &&
        next.kind !== 'lineComment';
      breakNext = (depths[index] ?? 0) === 0 && !sameLineStatement;
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
      const sameSourceLine = token.line === tokenEndLine(before);
      const keepSourceGap =
        sameSourceLine &&
        ((before.text === ';' && (depths[beforeIndex] ?? 0) === 0) ||
          (before.text === '{' && braces.kept.has(beforeIndex)));
      const space = comment
        ? true
        : needsSpace(before, token, style, {
            afterUnary: unary.has(tokenIndex),
            beforeUnary: unary.has(beforeIndex),
            declarator: isDeclaratorAt(tokens, tokenIndex) || isDeclaratorAt(tokens, beforeIndex),
            inTemplate: template.has(tokenIndex) || template.has(beforeIndex),
            inTernary: ternary.has(tokenIndex) || ternary.has(beforeIndex),
            keepSourceGap,
            sourceGap: sameSourceLine ? token.column - (before.column + before.text.length) : 1,
          });
      text += `${space ? ' ' : ''}${token.text}`;
    }
    assembled.push(text.trimEnd());
  }
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const formatted = `${bom}${assembled.join(eol)}${body.endsWith('\n') ? eol : ''}`;
  return { changed: formatted !== source, formatted, skipped: false };
}
