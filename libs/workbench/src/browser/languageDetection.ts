/**
 * 无扩展名文档的语言识别：按内容特征打分，够确信才定型。
 *
 * OIer 常直接在新建缓冲区里写代码后 Ctrl+S，漏写后缀就没法编译高亮，
 * 因此这里宁可"再等等"也不要猜错：证据不足时返回 undefined，
 * 由调用方保持上一次结论，等用户继续输入后再判。
 */
export type DetectedLanguage = 'cpp' | 'python' | 'javascript' | 'html';

export interface ILanguageGuess {
  readonly language: DetectedLanguage;
  /** 0–1 置信度 */
  readonly confidence: number;
}

/** 低于该置信度就不下结论，继续等更多证据。 */
export const LANGUAGE_CONFIDENCE_THRESHOLD = 0.85;

/** 累计权重达到该值即视为"证据充分"，可与单一强标记一一对应。 */
const DECISIVE_RAW = 0.5;

/** 单条权重达到该值即可直接定型（如 `#include`、`def f(`、`<!DOCTYPE html>`）。 */
const DECISIVE_SINGLE = 0.5;

const SIGNALS: Readonly<Record<DetectedLanguage, readonly (readonly [RegExp, number])[]>> = {
  cpp: [
    [/#\s*include\b/, 0.5],
    [/using\s+namespace\s+std\b/, 0.45],
    [/\bstd::/, 0.3],
    [/\bint\s+main\s*\(/, 0.35],
    [/\bcout\s*<</, 0.35],
    [/\bcin\s*>>/, 0.35],
    [/\bprintf\s*\(/, 0.3],
    [/\bscanf\s*\(/, 0.3],
    [/\bvector\s*</, 0.25],
    [/\bfor\s*\(\s*int\b/, 0.3],
    [/\bendl\b/, 0.2],
  ],
  python: [
    [/^\s*def\s+\w+\s*\(/m, 0.5],
    [/if\s+__name__\s*==/, 0.5],
    [/^\s*from\s+\w+\s+import\b/m, 0.35],
    [/^\s*import\s+\w+/m, 0.3],
    [/\belif\b/, 0.35],
    [/\binput\s*\(/, 0.3],
    [/\bprint\s*\(/, 0.25],
    [/\bself\.\w+/, 0.25],
    [/\brange\s*\(/, 0.2],
  ],
  javascript: [
    [/\bconsole\.\w+\s*\(/, 0.4],
    [/\bimport\s+[^;\n]+\s+from\s+['"]/, 0.4],
    [/\bdocument\.\w+/, 0.4],
    [/\brequire\s*\(/, 0.35],
    [/\bfunction\s+\w*\s*\([^)]*\)\s*\{/, 0.35],
    [/\bwindow\.\w+/, 0.35],
    [/\bvar\s+\w+\s*=/, 0.3],
    [/\balert\s*\(/, 0.3],
    [/\b(?:const|let)\s+\w+\s*=/, 0.25],
    [/=>/, 0.2],
  ],
  html: [
    [/<!doctype\s+html/i, 0.6],
    [/<html[\s>]/i, 0.5],
    [/<\/html>/i, 0.5],
    [/<body[\s>]/i, 0.45],
    [/<head[\s>]/i, 0.35],
    [/<title[\s>]/i, 0.35],
    [/<(?:div|span|table|ul|ol|li|form|input|button)\b/i, 0.25],
    [/<\/(?:div|span|body|html)>/i, 0.15],
  ],
};

const LANGUAGE_ORDER: readonly DetectedLanguage[] = ['cpp', 'python', 'javascript', 'html'];

/** 保存时补全文件名用的扩展名（不带点）。 */
export const LANGUAGE_EXTENSIONS: Readonly<Record<DetectedLanguage, string>> = {
  cpp: 'cpp',
  html: 'html',
  javascript: 'js',
  python: 'py',
};

interface ILanguageScore {
  readonly decisive: boolean;
  readonly language: DetectedLanguage;
  readonly score: number;
}

function scoreLanguage(language: DetectedLanguage, content: string): ILanguageScore {
  let score = 0;
  let decisive = false;
  for (const [pattern, weight] of SIGNALS[language]) {
    if (pattern.test(content)) {
      score += weight;
      decisive = decisive || weight >= DECISIVE_SINGLE;
    }
  }
  return { decisive, language, score };
}

/**
 * 按内容给出最可能的语言与置信度。
 * 置信度 = 证据充分度 × 排他度：只有弱信号时压低，两种语言都像时也压低；
 * 命中单条强标记（`#include`、`def f(`、`<!DOCTYPE html>` 等）直接定型。
 */
export function guessLanguage(content: string): ILanguageGuess | undefined {
  if (content.trim().length === 0) {
    return undefined;
  }
  const ranked = LANGUAGE_ORDER.map((language) => scoreLanguage(language, content)).sort(
    (left, right) => right.score - left.score,
  );
  const top = ranked[0];
  if (top === undefined || top.score === 0) {
    return undefined;
  }
  if (top.decisive) {
    return { confidence: 1, language: top.language };
  }
  const strength = Math.min(1, top.score / DECISIVE_RAW);
  const clarity = top.score / (top.score + (ranked[1]?.score ?? 0));
  return { confidence: strength * clarity, language: top.language };
}

/** 保存无后缀文档时的建议文件名：已定型则补上对应后缀，否则原名不动。 */
export function suggestFileName(name: string, detected: DetectedLanguage | undefined): string {
  if (detected === undefined || name.includes('.')) {
    return name;
  }
  return `${name}.${LANGUAGE_EXTENSIONS[detected]}`;
}

/** 置信度达标才返回语言，否则 undefined 表示"还判断不了，继续等"。 */
export function detectLanguageFromContent(content: string): DetectedLanguage | undefined {
  const guess = guessLanguage(content);
  return guess !== undefined && guess.confidence >= LANGUAGE_CONFIDENCE_THRESHOLD
    ? guess.language
    : undefined;
}
