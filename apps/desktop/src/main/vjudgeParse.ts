import {
  decodeHtmlEntities,
  problemKey,
  type IStatementVersion,
  type IVjudgeRemoteOj,
  type IVjudgeSubmission,
  type IVjudgeSubmissionBrief,
} from '@oi/platform';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

export function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function readBoolean(source: Record<string, unknown>, key: string): boolean {
  return source[key] === true;
}

/** 题面版本键在页面里是数字字面量，必须与字符串形式一并接受。 */
function readKey(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value === 'string') {
    return value;
  }
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/** 解析 `/util/cfg` 的远端 OJ 表（`{名: {languages, isAlive, …}}`）。 */
export function parseRemoteOjs(value: unknown): IVjudgeRemoteOj[] {
  if (!isRecord(value)) {
    return [];
  }
  const result: IVjudgeRemoteOj[] = [];
  for (const [name, raw] of Object.entries(value)) {
    if (!isRecord(raw)) {
      continue;
    }
    const languages = isRecord(raw['languages'])
      ? Object.entries(raw['languages'])
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
          .map(([id, label]) => ({ id, name: label }))
      : [];
    const credentialTypes = Array.isArray(raw['credentialTypes'])
      ? raw['credentialTypes'].filter((item): item is string => typeof item === 'string')
      : [];
    const declaredName = readString(raw, 'name');
    result.push({
      credentialTypes,
      homepage: readString(raw, 'homepage'),
      isAlive: readBoolean(raw, 'isAlive'),
      languages,
      name: declaredName.length > 0 ? declaredName : name,
    });
  }
  return result.sort((left, right) => left.name.localeCompare(right.name));
}

/** 解析题目页隐藏 `textarea[name=dataJson]` 中的题目状态。 */
export function parseProblemPageData(html: string): Record<string, unknown> | undefined {
  const match = /name="dataJson"[^>]*>([\s\S]*?)<\/textarea>/i.exec(html);
  if (match === null || match[1] === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(decodeHtmlEntities(match[1]));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** 解析题面版本表 `descBriefs`。 */
export function parseStatementVersions(value: unknown): IStatementVersion[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const versions: IStatementVersion[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) {
      continue;
    }
    const key = readKey(raw, 'key');
    if (key.length === 0) {
      continue;
    }
    const author = raw['author'];
    const remarks = raw['remarks'];
    versions.push({
      ...(typeof author === 'string' ? { author } : {}),
      key,
      lang: readString(raw, 'lang'),
      mainOfficial: readBoolean(raw, 'mainOfficial'),
      official: readBoolean(raw, 'official'),
      ...(typeof remarks === 'string' ? { remarks } : {}),
      type: readString(raw, 'type'),
      version: readNumber(raw, 'version') ?? 0,
    });
  }
  return versions;
}

/** 从 `properties` 数组里取指定标题的文本内容。 */
export function readProperty(data: Record<string, unknown>, title: string): string | undefined {
  if (!Array.isArray(data['properties'])) {
    return undefined;
  }
  for (const raw of data['properties']) {
    if (isRecord(raw) && readString(raw, 'title') === title) {
      return readString(raw, 'content');
    }
  }
  return undefined;
}

/** 解析 `mySols`：`[[runId, status, time, statusClass, statusCanonical]]`。 */
export function parseMySubmissions(value: unknown): IVjudgeSubmissionBrief[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: IVjudgeSubmissionBrief[] = [];
  for (const raw of value) {
    if (!Array.isArray(raw)) {
      continue;
    }
    const [runId, status, submitTime, , statusCanonical] = raw as unknown[];
    if (typeof runId !== 'number' || !Number.isFinite(runId)) {
      continue;
    }
    result.push({
      runId,
      status: typeof status === 'string' ? status : '',
      statusCanonical: typeof statusCanonical === 'string' ? statusCanonical : '',
      submitTime: typeof submitTime === 'number' && Number.isFinite(submitTime) ? submitTime : 0,
    });
  }
  return result;
}

/** 把 `/solution/data` 响应转为提交结果快照。 */
export function parseSubmission(runId: number, value: unknown): IVjudgeSubmission {
  const source = isRecord(value) ? value : {};
  const code = source['code'];
  const remoteRunId = source['remoteRunId'];
  const language = readString(source, 'language');
  const runtimeMs = readNumber(source, 'runtime');
  const memoryKb = readNumber(source, 'memory');
  const submitTime = readNumber(source, 'submitTime');
  return {
    ...(typeof code === 'string' ? { code } : {}),
    ...(language.length > 0 ? { language } : {}),
    ...(memoryKb === undefined ? {} : { memoryKb }),
    oj: readString(source, 'oj'),
    ...(typeof remoteRunId === 'string'
      ? { remoteRunId }
      : typeof remoteRunId === 'number'
        ? { remoteRunId: String(remoteRunId) }
        : {}),
    probNum: readString(source, 'probNum'),
    processing: readBoolean(source, 'processing'),
    runId,
    ...(runtimeMs === undefined ? {} : { runtimeMs }),
    status: readString(source, 'status'),
    statusCanonical: readString(source, 'statusCanonical'),
    ...(submitTime === undefined ? {} : { submitTime }),
  };
}

/** 把 `acRecords` / `failRecords`（`{OJ: [题号]}`）摊平为 `OJ-题号` 列表。 */
export function parseSolvedRecords(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }
  const keys: string[] = [];
  for (const [oj, raw] of Object.entries(value)) {
    if (!Array.isArray(raw)) {
      continue;
    }
    for (const item of raw) {
      if (typeof item === 'string' && item.length > 0) {
        keys.push(problemKey(oj, item));
      }
    }
  }
  return keys.sort();
}
