import type { IAutoSaveDraft, IAutoSaveServiceClient } from './autosave';
import type { IChannel } from './ipc/channel';
import { AUTOSAVE_RPC_METHODS } from './ipc/protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseDraft(value: unknown): IAutoSaveDraft | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { uri, content, savedAtMs, originalMtimeMs } = value;
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
 * {@link IAutoSaveServiceClient} 的 JSON-RPC 客户端代理。
 */
export class AutoSaveServiceClient implements IAutoSaveServiceClient {
  constructor(private readonly _channel: IChannel) {}

  async saveDraft(uri: string, content: string): Promise<void> {
    await this._channel.call(AUTOSAVE_RPC_METHODS.saveDraft, { uri, content });
  }

  async clearDraft(uri: string): Promise<void> {
    await this._channel.call(AUTOSAVE_RPC_METHODS.clearDraft, { uri });
  }

  async clearAllDrafts(): Promise<void> {
    await this._channel.call(AUTOSAVE_RPC_METHODS.clearAllDrafts);
  }

  async scanDrafts(): Promise<readonly IAutoSaveDraft[]> {
    const drafts = await this._channel.call<unknown[]>(AUTOSAVE_RPC_METHODS.scanDrafts);
    return drafts.flatMap((draft) => {
      const parsed = parseDraft(draft);
      return parsed === undefined ? [] : [parsed];
    });
  }
}
