import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { URI, toError } from '@oi/base';
import { ILogService, type IAutoSaveDraft, type IAutoSaveService } from '@oi/platform';

/** 草稿文件后缀，用于目录内识别与清理。 */
export const AUTOSAVE_DRAFT_EXTENSION = '.oi-autosave';

/** mtime 浮点比较容差（毫秒）。 */
const MTIME_TOLERANCE_MS = 1;
const HASH_LENGTH = 16;

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const ILLEGAL_FILENAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

function sanitizeBaseName(name: string): string {
  let result = '';
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    result += code < 0x20 || ILLEGAL_FILENAME_CHARS.has(char) ? '_' : char;
  }
  return result.replace(/[. ]+$/, '');
}

/**
 * 构造草稿文件名：`{原始文件名}.{URI 哈希}.oi-autosave`，非法字符替换为下划线。
 */
export function draftFileName(uri: string): string {
  const parsed = safeParseUri(uri);
  const rawName = parsed === undefined ? '' : basename(parsed.path);
  const base = sanitizeBaseName(rawName);
  const hash = createHash('sha256').update(uri).digest('hex').slice(0, HASH_LENGTH);
  return `${base.length > 0 ? base : 'untitled'}.${hash}${AUTOSAVE_DRAFT_EXTENSION}`;
}

function safeParseUri(uri: string): URI | undefined {
  try {
    return URI.parse(uri);
  } catch {
    return undefined;
  }
}

/**
 * 解析草稿文件 JSON；字段缺失或类型不符时返回 undefined（视为损坏）。
 */
export function parseDraftFile(text: string): IAutoSaveDraft | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const { uri, content, savedAtMs, originalMtimeMs } = parsed;
  if (typeof uri !== 'string' || typeof content !== 'string' || typeof savedAtMs !== 'number') {
    return undefined;
  }
  return {
    uri,
    content,
    savedAtMs,
    ...(typeof originalMtimeMs === 'number' ? { originalMtimeMs } : {}),
  };
}

/**
 * 静默自动保存的 Node 实现：草稿写入独立临时目录。
 * 仅当原文件自草稿写入后未被修改时，草稿才可恢复；陈旧与损坏草稿在扫描时清理。
 */
export class AutoSaveService implements IAutoSaveService {
  constructor(
    @ILogService private readonly _logService: ILogService,
    private readonly _directory: string,
  ) {}

  async saveDraft(uri: string, content: string): Promise<void> {
    const draft: IAutoSaveDraft = {
      uri,
      content,
      savedAtMs: Date.now(),
      ...(await this._originalMtime(uri)),
    };
    await mkdir(this._directory, { recursive: true });
    await writeFile(this._draftPath(uri), JSON.stringify(draft), 'utf8');
  }

  async clearDraft(uri: string): Promise<void> {
    await this._removeFile(this._draftPath(uri));
  }

  async clearAllDrafts(): Promise<void> {
    for (const path of await this._listDraftPaths()) {
      await this._removeFile(path);
    }
  }

  async scanDrafts(): Promise<readonly IAutoSaveDraft[]> {
    const drafts: IAutoSaveDraft[] = [];
    for (const path of await this._listDraftPaths()) {
      const draft = await this._readDraft(path);
      if (draft === undefined) {
        this._logService.warn(`已清理损坏的自动保存草稿：${path}`);
        await this._removeFile(path);
        continue;
      }
      if (await this._isRecoverable(draft)) {
        drafts.push(draft);
      } else {
        // 原文件已保存或删除，草稿过期
        await this._removeFile(path);
      }
    }
    return drafts.sort((left, right) => right.savedAtMs - left.savedAtMs);
  }

  private _draftPath(uri: string): string {
    return join(this._directory, draftFileName(uri));
  }

  private async _listDraftPaths(): Promise<string[]> {
    if (!existsSync(this._directory)) {
      return [];
    }
    try {
      const entries = await readdir(this._directory);
      return entries
        .filter((entry) => entry.endsWith(AUTOSAVE_DRAFT_EXTENSION))
        .map((entry) => join(this._directory, entry));
    } catch (error) {
      this._logService.warn(`自动保存目录读取失败：${this._directory}`, toError(error).message);
      return [];
    }
  }

  private async _readDraft(path: string): Promise<IAutoSaveDraft | undefined> {
    try {
      return parseDraftFile(await readFile(path, 'utf8'));
    } catch (error) {
      this._logService.warn(`自动保存草稿读取失败：${path}`, toError(error).message);
      return undefined;
    }
  }

  /**
   * 草稿可恢复条件：非 file URI（如 untitled）没有磁盘原文可比对，视为可恢复；
   * file URI 要求原文件仍存在且 mtime 与草稿写入时一致。
   */
  private async _isRecoverable(draft: IAutoSaveDraft): Promise<boolean> {
    const parsed = safeParseUri(draft.uri);
    if (parsed === undefined || parsed.scheme !== 'file') {
      return true;
    }
    if (draft.originalMtimeMs === undefined || !existsSync(parsed.fsPath)) {
      return false;
    }
    try {
      const current = await stat(parsed.fsPath);
      return Math.abs(current.mtimeMs - draft.originalMtimeMs) <= MTIME_TOLERANCE_MS;
    } catch (error) {
      this._logService.warn(`自动保存恢复检查失败：${parsed.fsPath}`, toError(error).message);
      return false;
    }
  }

  private async _originalMtime(uri: string): Promise<{ originalMtimeMs?: number }> {
    const parsed = safeParseUri(uri);
    if (parsed === undefined || parsed.scheme !== 'file' || !existsSync(parsed.fsPath)) {
      return {};
    }
    try {
      const info = await stat(parsed.fsPath);
      return { originalMtimeMs: info.mtimeMs };
    } catch (error) {
      this._logService.warn(`自动保存原文件状态读取失败：${parsed.fsPath}`, toError(error).message);
      return {};
    }
  }

  private async _removeFile(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) {
        this._logService.warn(`自动保存草稿清理失败：${path}`, toError(error).message);
      }
    }
  }
}
