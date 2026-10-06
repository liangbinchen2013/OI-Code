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

/** `Ctrl+N` 直接使用的新建默认模板。 */
export const DEFAULT_TEMPLATE = CPP_TEMPLATE;

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
 * 读取用户自定义模板；存储损坏或不可用时返回空列表。
 */
export function loadCustomTemplates(): IFileTemplate[] {
  try {
    const raw = window.localStorage.getItem(TEMPLATES_STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isTemplate) : [];
  } catch (error) {
    onUnexpectedError(error);
    return [];
  }
}

export function saveCustomTemplates(templates: readonly IFileTemplate[]): void {
  try {
    window.localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
  } catch (error) {
    onUnexpectedError(error);
  }
}

export function createTemplateId(): string {
  return `t-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
