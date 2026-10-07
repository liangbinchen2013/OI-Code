import { createDecorator } from './instantiation';

/**
 * 自动保存草稿：正文与恢复判定所需的元数据。
 * `originalMtimeMs` 为草稿写入时原文件的修改时间；原文件不存在或非 file URI 时缺省。
 */
export interface IAutoSaveDraft {
  /** 原始文档 URI 字符串（含 untitled 文档）。 */
  readonly uri: string;
  /** 草稿对应的编辑器全文。 */
  readonly content: string;
  /** 草稿写入时间（毫秒时间戳）。 */
  readonly savedAtMs: number;
  /** 草稿写入时原文件修改时间（毫秒时间戳）。 */
  readonly originalMtimeMs?: number;
}

/**
 * 静默自动保存契约：渲染进程定时上报脏文档，落盘与恢复扫描由主进程实现。
 * 保存过程不产生任何用户可见提示。
 */
export interface IAutoSaveService {
  /** 写入/覆盖指定文档的草稿。 */
  saveDraft(uri: string, content: string): Promise<void>;
  /** 删除指定文档的草稿（保存成功、关闭标签或用户放弃恢复时）。 */
  clearDraft(uri: string): Promise<void>;
  /** 清理全部草稿（正常退出时）。 */
  clearAllDrafts(): Promise<void>;
  /** 扫描可恢复草稿，并清理原文件已变化的陈旧草稿。 */
  scanDrafts(): Promise<readonly IAutoSaveDraft[]>;
}

/**
 * 渲染进程侧的自动保存服务：JSON-RPC 代理，与 {@link IAutoSaveService} 同形。
 */
export type IAutoSaveServiceClient = IAutoSaveService;

export const IAutoSaveService = createDecorator<IAutoSaveService>('autoSaveService');
