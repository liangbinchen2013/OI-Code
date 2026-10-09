/**
 * 代码格式化风格档案：多套命名风格，用户自己贴样本生成，也可手动微调。
 *
 * 存储沿用工作台既有的 localStorage 偏好模式：读取时逐字段归位，
 * 坏数据回落默认档案而不是抛异常。
 */
import { onUnexpectedError } from '@oi/base';
import { DEFAULT_CPP_STYLE, type ICppStyle } from '@oi/editor';

const FORMAT_PROFILES_KEY = 'oi-code.format-profiles';

export interface IFormatProfile {
  readonly id: string;
  readonly name: string;
  readonly style: ICppStyle;
}

export interface IFormatProfileStore {
  readonly profiles: readonly IFormatProfile[];
  readonly activeId: string;
}

export const BUILT_IN_PROFILE_ID = 'built-in-default';

export const DEFAULT_FORMAT_PROFILES: IFormatProfileStore = {
  activeId: BUILT_IN_PROFILE_ID,
  profiles: [{ id: BUILT_IN_PROFILE_ID, name: '默认风格', style: DEFAULT_CPP_STYLE }],
};

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** 逐字段归位风格；非法值回默认，避免坏数据把格式化器带崩。 */
export function normalizeStyle(value: unknown): ICppStyle {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_CPP_STYLE;
  }
  const source = value as Record<string, unknown>;
  const indentWidth = source['indentWidth'];
  const maxBlankLines = source['maxBlankLines'];
  return {
    attachPointerToType: readBoolean(
      source['attachPointerToType'],
      DEFAULT_CPP_STYLE.attachPointerToType,
    ),
    braceNextLine: readBoolean(source['braceNextLine'], DEFAULT_CPP_STYLE.braceNextLine),
    elseSameLine: readBoolean(source['elseSameLine'], DEFAULT_CPP_STYLE.elseSameLine),
    indentWidth:
      typeof indentWidth === 'number' && [2, 3, 4, 8].includes(indentWidth)
        ? indentWidth
        : DEFAULT_CPP_STYLE.indentWidth,
    indentWithTabs: readBoolean(source['indentWithTabs'], DEFAULT_CPP_STYLE.indentWithTabs),
    maxBlankLines:
      typeof maxBlankLines === 'number' && Number.isFinite(maxBlankLines)
        ? Math.min(4, Math.max(0, Math.round(maxBlankLines)))
        : DEFAULT_CPP_STYLE.maxBlankLines,
    singleStatementOnSameLine: readBoolean(
      source['singleStatementOnSameLine'],
      DEFAULT_CPP_STYLE.singleStatementOnSameLine,
    ),
    spaceAfterComma: readBoolean(source['spaceAfterComma'], DEFAULT_CPP_STYLE.spaceAfterComma),
    spaceAfterControlKeyword: readBoolean(
      source['spaceAfterControlKeyword'],
      DEFAULT_CPP_STYLE.spaceAfterControlKeyword,
    ),
    spaceAfterSemicolon: readBoolean(
      source['spaceAfterSemicolon'],
      DEFAULT_CPP_STYLE.spaceAfterSemicolon,
    ),
    spaceAroundBinaryOperator: readBoolean(
      source['spaceAroundBinaryOperator'],
      DEFAULT_CPP_STYLE.spaceAroundBinaryOperator,
    ),
    spaceBeforeBrace: readBoolean(source['spaceBeforeBrace'], DEFAULT_CPP_STYLE.spaceBeforeBrace),
    spaceInsideParens: readBoolean(
      source['spaceInsideParens'],
      DEFAULT_CPP_STYLE.spaceInsideParens,
    ),
  };
}

export function normalizeFormatProfiles(value: unknown): IFormatProfileStore {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_FORMAT_PROFILES;
  }
  const source = value as { profiles?: unknown; activeId?: unknown };
  if (!Array.isArray(source.profiles)) {
    return DEFAULT_FORMAT_PROFILES;
  }
  const profiles: IFormatProfile[] = [];
  for (const raw of source.profiles) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const profile = raw as { id?: unknown; name?: unknown; style?: unknown };
    if (typeof profile.id !== 'string' || profile.id.length === 0) {
      continue;
    }
    profiles.push({
      id: profile.id,
      name:
        typeof profile.name === 'string' && profile.name.trim().length > 0
          ? profile.name
          : profile.id,
      style: normalizeStyle(profile.style),
    });
  }
  if (profiles.length === 0) {
    return DEFAULT_FORMAT_PROFILES;
  }
  const activeId =
    typeof source.activeId === 'string' &&
    profiles.some((profile) => profile.id === source.activeId)
      ? source.activeId
      : (profiles[0] as IFormatProfile).id;
  return { activeId, profiles };
}

export function readFormatProfiles(): IFormatProfileStore {
  try {
    const raw = window.localStorage.getItem(FORMAT_PROFILES_KEY);
    if (raw === null) {
      return DEFAULT_FORMAT_PROFILES;
    }
    return normalizeFormatProfiles(JSON.parse(raw));
  } catch (error) {
    onUnexpectedError(error);
    return DEFAULT_FORMAT_PROFILES;
  }
}

export function persistFormatProfiles(store: IFormatProfileStore): void {
  try {
    window.localStorage.setItem(FORMAT_PROFILES_KEY, JSON.stringify(store));
  } catch (error) {
    onUnexpectedError(error);
  }
}

export function createProfileId(): string {
  return `p-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** 当前生效档案的风格；档案被删空时回落默认。 */
export function activeStyle(store: IFormatProfileStore): ICppStyle {
  const active = store.profiles.find((profile) => profile.id === store.activeId);
  return (active ?? store.profiles[0])?.style ?? DEFAULT_CPP_STYLE;
}

export function addProfile(
  store: IFormatProfileStore,
  name: string,
  style: ICppStyle,
): IFormatProfileStore {
  const id = createProfileId();
  return {
    activeId: id,
    profiles: [
      ...store.profiles,
      { id, name: name.trim().length > 0 ? name.trim() : '新风格', style },
    ],
  };
}

export function updateProfile(
  store: IFormatProfileStore,
  id: string,
  patch: { readonly name?: string; readonly style?: ICppStyle },
): IFormatProfileStore {
  return {
    ...store,
    profiles: store.profiles.map((profile) =>
      profile.id === id
        ? {
            ...profile,
            ...(patch.name === undefined ? {} : { name: patch.name.trim() || profile.name }),
            ...(patch.style === undefined ? {} : { style: normalizeStyle(patch.style) }),
          }
        : profile,
    ),
  };
}

export function removeProfile(store: IFormatProfileStore, id: string): IFormatProfileStore {
  if (store.profiles.length <= 1) {
    return store;
  }
  const profiles = store.profiles.filter((profile) => profile.id !== id);
  return {
    activeId: store.activeId === id ? ((profiles[0] as IFormatProfile).id ?? id) : store.activeId,
    profiles,
  };
}

export function setActiveProfile(store: IFormatProfileStore, id: string): IFormatProfileStore {
  return store.profiles.some((profile) => profile.id === id) ? { ...store, activeId: id } : store;
}
