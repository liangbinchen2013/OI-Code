import { onUnexpectedError } from '@oi/base';

/**
 * 新建文件模板：扩展名不带点；内容原样写入未命名缓冲区。
 */
export interface IFileTemplate {
  readonly id: string;
  readonly name: string;
  readonly extension: string;
  readonly content: string;
}

const TEMPLATES_STORAGE_KEY = 'oi-code.templates';

const CPP_CONTENT = `#include <bits/stdc++.h>
using namespace std;

int main() {
    
    return 0;
}
`;

const PYTHON_CONTENT = `import sys


def main():
    pass


if __name__ == "__main__":
    main()
`;

export const CPP_TEMPLATE: IFileTemplate = {
  id: 'builtin-cpp',
  name: 'C++ 文件',
  extension: 'cpp',
  content: CPP_CONTENT,
};

export const PYTHON_TEMPLATE: IFileTemplate = {
  id: 'builtin-python',
  name: 'Python 文件',
  extension: 'py',
  content: PYTHON_CONTENT,
};

export const BUILT_IN_TEMPLATES: readonly IFileTemplate[] = [CPP_TEMPLATE, PYTHON_TEMPLATE];

/** + 菜单固定项：创建无后缀的空文件。 */
export const PLAIN_TEMPLATE: IFileTemplate = {
  id: 'builtin-plain',
  name: '文件',
  extension: '',
  content: '',
};

/** `Ctrl+N` 直接使用的新建默认模板。 */
export const DEFAULT_TEMPLATE = CPP_TEMPLATE;

export const BUILT_IN_TEMPLATE_IDS: ReadonlySet<string> = new Set(
  BUILT_IN_TEMPLATES.map((template) => template.id),
);

/**
 * 模板持久化结构：内置模板的覆盖项与用户新增模板同存于 custom；
 * hidden 记录被用户删除的内置模板 id。
 */
export interface ITemplateStore {
  readonly custom: readonly IFileTemplate[];
  readonly hidden: readonly string[];
  /** Ctrl+N 使用的模板 id；缺省或失效时回退 C++ 内置模板。 */
  readonly defaultTemplateId?: string;
}

export const EMPTY_TEMPLATE_STORE: ITemplateStore = { custom: [], hidden: [] };

function isTemplate(value: unknown): value is IFileTemplate {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof IFileTemplate, unknown>>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.extension === 'string' &&
    typeof candidate.content === 'string'
  );
}

/**
 * 读取模板持久化结构；兼容旧版直接存放数组的格式；损坏时回退为空。
 */
export function loadTemplateStore(): ITemplateStore {
  try {
    const raw = window.localStorage.getItem(TEMPLATES_STORAGE_KEY);
    if (raw === null) {
      return EMPTY_TEMPLATE_STORE;
    }
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { custom: parsed.filter(isTemplate), hidden: [] };
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return EMPTY_TEMPLATE_STORE;
    }
    const { custom, hidden, defaultTemplateId } = parsed as {
      custom?: unknown;
      hidden?: unknown;
      defaultTemplateId?: unknown;
    };
    return {
      custom: Array.isArray(custom) ? custom.filter(isTemplate) : [],
      hidden: Array.isArray(hidden)
        ? hidden.filter((id): id is string => typeof id === 'string')
        : [],
      ...(typeof defaultTemplateId === 'string' ? { defaultTemplateId } : {}),
    };
  } catch (error) {
    onUnexpectedError(error);
    return EMPTY_TEMPLATE_STORE;
  }
}

export function saveTemplateStore(store: ITemplateStore): void {
  try {
    window.localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(store));
  } catch (error) {
    onUnexpectedError(error);
  }
}

function templateEquals(left: IFileTemplate, right: IFileTemplate): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.extension === right.extension &&
    left.content === right.content
  );
}

/**
 * 合成 + 菜单使用的模板列表：内置模板可被同 id 覆盖或被隐藏，
 * 自定义新增模板追加在内置模板之后。
 */
export function mergeTemplateStore(store: ITemplateStore): IFileTemplate[] {
  const overrides = new Map(store.custom.map((template) => [template.id, template]));
  const hidden = new Set(store.hidden);
  const merged: IFileTemplate[] = [];
  for (const builtIn of BUILT_IN_TEMPLATES) {
    if (hidden.has(builtIn.id)) {
      continue;
    }
    merged.push(overrides.get(builtIn.id) ?? builtIn);
  }
  for (const template of store.custom) {
    if (!BUILT_IN_TEMPLATE_IDS.has(template.id)) {
      merged.push(template);
    }
  }
  return merged;
}

/**
 * 由编辑后的完整模板列表反推持久化结构：
 * 与内置默认一致的项不落盘；缺失的内置 id 视为隐藏；其余按覆盖/新增保存。
 */
export function templateStoreFromList(
  templates: readonly IFileTemplate[],
  defaultTemplateId?: string,
): ITemplateStore {
  const builtInById = new Map(BUILT_IN_TEMPLATES.map((template) => [template.id, template]));
  const remaining = new Set(templates.map((template) => template.id));
  const hidden = BUILT_IN_TEMPLATES.filter((template) => !remaining.has(template.id)).map(
    (template) => template.id,
  );
  const custom = templates.filter((template) => {
    const builtIn = builtInById.get(template.id);
    return builtIn === undefined || !templateEquals(builtIn, template);
  });
  return { custom, hidden, ...(defaultTemplateId === undefined ? {} : { defaultTemplateId }) };
}

/**
 * 解析 Ctrl+N 默认模板：配置失效（被隐藏/删除）时回退到首个可用模板。
 */
export function resolveDefaultTemplate(
  templates: readonly IFileTemplate[],
  defaultTemplateId: string | undefined,
): IFileTemplate {
  return (
    templates.find((template) => template.id === defaultTemplateId) ??
    templates.find((template) => template.id === DEFAULT_TEMPLATE.id) ??
    templates[0] ??
    DEFAULT_TEMPLATE
  );
}

export function createTemplateId(): string {
  return `t-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
