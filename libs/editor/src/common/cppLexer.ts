/**
 * C++ 词法切分：为风格分析与格式化提供不丢失内容的 token 流。
 *
 * 只做切分不做改写；预处理行、注释、字符串与字符字面量整体成 token，
 * 后续阶段据此保证"格式化不会动这些内容"。
 */
export type TokenKind =
  | 'identifier'
  | 'keyword'
  | 'number'
  | 'string'
  | 'character'
  | 'punct'
  | 'lineComment'
  | 'blockComment'
  | 'preprocessor';

export interface ICppToken {
  readonly kind: TokenKind;
  readonly text: string;
  /** 起始行（0 基），用于还原空行与注释归属。 */
  readonly line: number;
  /** 起始列（0 基，按原始文本计）。 */
  readonly column: number;
}

/** 影响排版决策的关键字集合；其余标识符按普通名字处理。 */
export const CPP_CONTROL_KEYWORDS: ReadonlySet<string> = new Set([
  'break',
  'case',
  'continue',
  'default',
  'do',
  'else',
  'for',
  'if',
  'return',
  'switch',
  'while',
]);

const CPP_KEYWORDS: ReadonlySet<string> = new Set([
  'asm',
  'auto',
  'bool',
  'break',
  'case',
  'catch',
  'char',
  'class',
  'const',
  'constexpr',
  'continue',
  'decltype',
  'default',
  'delete',
  'do',
  'double',
  'else',
  'enum',
  'explicit',
  'export',
  'extern',
  'false',
  'float',
  'for',
  'friend',
  'goto',
  'if',
  'inline',
  'int',
  'long',
  'mutable',
  'namespace',
  'new',
  'noexcept',
  'nullptr',
  'operator',
  'private',
  'protected',
  'public',
  'register',
  'return',
  'short',
  'signed',
  'sizeof',
  'static',
  'struct',
  'switch',
  'template',
  'this',
  'throw',
  'true',
  'try',
  'typedef',
  'typename',
  'union',
  'unsigned',
  'using',
  'virtual',
  'void',
  'volatile',
  'while',
]);

/** 原始字符串前缀（出现在 `"` 之前时改变字符串解析规则）。 */
const RAW_STRING_PREFIXES: ReadonlySet<string> = new Set(['R', 'u8R', 'uR', 'UR', 'LR']);

/** 多字符运算符按长度优先匹配，避免 `>>` 被切成两个 `>`。 */
const PUNCTUATORS: readonly string[] = [
  '...',
  '<<=',
  '>>=',
  '->*',
  '::',
  '<=',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  '++',
  '--',
  '->',
  '.*',
  '<<',
  '>>',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '{',
  '}',
  '(',
  ')',
  '[',
  ']',
  ';',
  ',',
  '.',
  '*',
  '&',
  '|',
  '^',
  '%',
  '!',
  '~',
  '<',
  '>',
  '=',
  '+',
  '-',
  '/',
  '?',
  ':',
  '#',
  '@',
  '`',
  '\\',
  '$',
];

const NUMBER_START = /[0-9]/;
const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

/** `#` 只有出现在行首（前面仅空白）时才是预处理指令。 */
function atLineStart(source: string, index: number): boolean {
  for (let position = index - 1; position >= 0; position -= 1) {
    const char = source[position] as string;
    if (char === '\n') {
      return true;
    }
    if (char !== ' ' && char !== '\t' && char !== '\r') {
      return false;
    }
  }
  return true;
}

function isSpace(char: string): boolean {
  return (
    char === ' ' ||
    char === '\t' ||
    char === '\r' ||
    char === '\n' ||
    char === '\f' ||
    char === '\v'
  );
}

/** 扫描数字字面量长度；不是数字开头时返回 0。 */
function scanNumber(source: string, start: number): number {
  let index = start;
  const rest = source.slice(index);
  const hexOrBinary = /^0[xX][0-9a-fA-F']+/.exec(rest) ?? /^0[bB][01']+/.exec(rest);
  if (hexOrBinary !== null) {
    index += hexOrBinary[0].length;
  } else {
    const integer = /^\d[\d']*/.exec(rest);
    if (integer === null) {
      const fraction = /^\.\d[\d']*/.exec(rest);
      if (fraction === null) {
        return 0;
      }
      index += fraction[0].length;
    } else {
      index += integer[0].length;
      const after = /^\.\d[\d']*/.exec(source.slice(index));
      if (after !== null) {
        index += after[0].length;
      }
    }
    const exponent = /^[eE][+-]?\d+/.exec(source.slice(index));
    if (exponent !== null) {
      index += exponent[0].length;
    }
  }
  const suffix = /^[uUlLfF]+/.exec(source.slice(index));
  if (suffix !== null) {
    index += suffix[0].length;
  }
  const userLiteral = /^_[A-Za-z_]\w*/.exec(source.slice(index));
  if (userLiteral !== null) {
    index += userLiteral[0].length;
  }
  return index - start;
}

/** 扫描普通字符串或字符字面量（含转义）长度。 */
function scanQuoted(source: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < source.length) {
    const char = source[index] as string;
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === quote) {
      return index + 1 - start;
    }
    // 未闭合的引号不跨行，避免把整份文件吞成一个 token
    if (char === '\n') {
      return 0;
    }
    index += 1;
  }
  return 0;
}

/** 扫描原始字符串 `R"delim(...)delim"` 长度；找不到结束标记时返回 0。 */
function scanRawString(source: string, quoteIndex: number): number {
  const open = source.indexOf('(', quoteIndex + 1);
  if (open < 0) {
    return 0;
  }
  const delimiter = source.slice(quoteIndex + 1, open);
  const close = `)${delimiter}"`;
  const end = source.indexOf(close, open + 1);
  if (end < 0) {
    return 0;
  }
  return end + close.length - quoteIndex;
}

function scanLine(source: string, start: number): number {
  const end = source.indexOf('\n', start);
  return end < 0 ? source.length : end;
}

/** 预处理行：`#` 开头的整行，含反斜杠续行。 */
function scanPreprocessor(source: string, start: number): number {
  let index = start;
  for (;;) {
    const lineEnd = scanLine(source, index);
    const line = source.slice(index, lineEnd);
    if (!line.endsWith('\\')) {
      return lineEnd - start;
    }
    if (lineEnd >= source.length) {
      return source.length - start;
    }
    index = lineEnd + 1;
  }
}

/**
 * 切分 C++ 源码。
 * @param source 原始代码
 * @returns token 流；无法识别的字符按单字符 `punct` 输出，保证内容不丢失
 */
export function tokenizeCpp(source: string): ICppToken[] {
  const tokens: ICppToken[] = [];
  let index = 0;
  let line = 0;
  let column = 0;

  const push = (kind: TokenKind, text: string): void => {
    tokens.push({ column, kind, line, text });
    for (const char of text) {
      if (char === '\n') {
        line += 1;
        column = 0;
      } else {
        column += 1;
      }
    }
  };

  while (index < source.length) {
    const char = source[index] as string;
    if (isSpace(char)) {
      if (char === '\n') {
        line += 1;
        column = 0;
      } else if (char !== '\r') {
        column += 1;
      }
      index += 1;
      continue;
    }
    // 行首（允许前置空白）的 `#` 是预处理指令，整行原样保留
    if (char === '#' && atLineStart(source, index)) {
      const length = scanPreprocessor(source, index);
      push('preprocessor', source.slice(index, index + length));
      index += length;
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      const end = scanLine(source, index);
      push('lineComment', source.slice(index, end));
      index = end;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end < 0 ? source.length : end + 2;
      push('blockComment', source.slice(index, stop));
      index = stop;
      continue;
    }
    if (IDENT_START.test(char)) {
      let end = index + 1;
      while (end < source.length && IDENT_PART.test(source[end] as string)) {
        end += 1;
      }
      const word = source.slice(index, end);
      const rawPrefix = RAW_STRING_PREFIXES.has(word) && source[end] === '"';
      if (rawPrefix) {
        const length = scanRawString(source, end);
        if (length > 0) {
          push('string', source.slice(index, end + length));
          index += end - index + length;
          continue;
        }
      }
      push(CPP_KEYWORDS.has(word) ? 'keyword' : 'identifier', word);
      index = end;
      continue;
    }
    if (NUMBER_START.test(char) || (char === '.' && NUMBER_START.test(source[index + 1] ?? ''))) {
      const length = scanNumber(source, index);
      if (length > 0) {
        push('number', source.slice(index, index + length));
        index += length;
        continue;
      }
    }
    if (char === '"' || char === "'") {
      const length = scanQuoted(source, index, char);
      if (length > 0) {
        push(char === '"' ? 'string' : 'character', source.slice(index, index + length));
        index += length;
        continue;
      }
    }
    const punct = PUNCTUATORS.find((candidate) => source.startsWith(candidate, index));
    if (punct !== undefined) {
      push('punct', punct);
      index += punct.length;
      continue;
    }
    push('punct', char);
    index += 1;
  }
  return tokens;
}
