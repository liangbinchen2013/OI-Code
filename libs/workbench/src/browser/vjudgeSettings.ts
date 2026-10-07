import { onUnexpectedError } from '@oi/base';
import { WORKBENCH_STRINGS } from './strings';
import type { ITestCase } from '@oi/platform';

const VJUDGE_SETTINGS_KEY = 'oi-code.vjudge-settings';
const VJUDGE_CASES_KEY = 'oi-code.vjudge-cases';

/** VJudge 用户偏好。 */
export interface IVjudgeSettings {
  /** 提交前先用本地测试点评测一遍。 */
  readonly preflight: boolean;
}

export const DEFAULT_VJUDGE_SETTINGS: IVjudgeSettings = { preflight: true };

/** 按题目主键保存的本地测试点集合。 */
export type IVjudgeCaseStore = Readonly<Record<string, readonly ITestCase[]>>;

/** 校验并归位外部输入；非法字段回退默认值。 */
export function normalizeVjudgeSettings(value: unknown): IVjudgeSettings {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_VJUDGE_SETTINGS;
  }
  const { preflight } = value as { preflight?: unknown };
  return {
    preflight: typeof preflight === 'boolean' ? preflight : DEFAULT_VJUDGE_SETTINGS.preflight,
  };
}

function parseCase(value: unknown): ITestCase | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const { name, input, expectedOutput } = value as Record<string, unknown>;
  if (typeof input !== 'string' || typeof expectedOutput !== 'string') {
    return undefined;
  }
  return {
    name:
      typeof name === 'string' && name.length > 0 ? name : WORKBENCH_STRINGS.vjudgeCaseDefaultName,
    input,
    expectedOutput,
  };
}

/** 归位测试点存储：丢弃结构非法的条目与空题号。 */
export function normalizeVjudgeCases(value: unknown): IVjudgeCaseStore {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const result: Record<string, ITestCase[]> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key.trim().length === 0 || !Array.isArray(raw)) {
      continue;
    }
    const cases = raw.map(parseCase).filter((item): item is ITestCase => item !== undefined);
    if (cases.length > 0) {
      result[key] = cases;
    }
  }
  return result;
}

export function readVjudgeSettings(): IVjudgeSettings {
  try {
    const raw = window.localStorage.getItem(VJUDGE_SETTINGS_KEY);
    return raw === null ? DEFAULT_VJUDGE_SETTINGS : normalizeVjudgeSettings(JSON.parse(raw));
  } catch (error) {
    onUnexpectedError(error);
    return DEFAULT_VJUDGE_SETTINGS;
  }
}

export function persistVjudgeSettings(settings: IVjudgeSettings): void {
  try {
    window.localStorage.setItem(VJUDGE_SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    onUnexpectedError(error);
  }
}

export function readVjudgeCases(): IVjudgeCaseStore {
  try {
    const raw = window.localStorage.getItem(VJUDGE_CASES_KEY);
    return raw === null ? {} : normalizeVjudgeCases(JSON.parse(raw));
  } catch (error) {
    onUnexpectedError(error);
    return {};
  }
}

/** 覆盖某题的测试点并落盘；传空数组表示移除该题记录。 */
export function saveVjudgeCases(key: string, cases: readonly ITestCase[]): IVjudgeCaseStore {
  const store = { ...readVjudgeCases() };
  if (cases.length === 0) {
    delete store[key];
  } else {
    store[key] = cases;
  }
  try {
    window.localStorage.setItem(VJUDGE_CASES_KEY, JSON.stringify(store));
  } catch (error) {
    onUnexpectedError(error);
  }
  return store;
}
