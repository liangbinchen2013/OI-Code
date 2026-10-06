import { DisposableStore, Emitter, type Event, type IDisposable, type URI } from '@oi/base';
import {
  deserializeDiagnostic,
  type ICodeDiagnostic,
  type ICodeDiagnosticWire,
} from './diagnostics';
import type { IChannel } from './ipc/channel';
import { TOOLCHAIN_RPC_METHODS, TOOLCHAIN_RPC_NOTIFICATIONS } from './ipc/protocol';
import type { IRunResult } from './runner';
import type {
  ICompileRequest,
  ICompileResult,
  ISearchProgress,
  IToolchainService,
  IToolchainStatus,
} from './toolchain';

interface ICompileResultWire {
  readonly ok: boolean;
  readonly executablePath?: string;
  readonly durationMs: number;
  readonly diagnostics: readonly ICodeDiagnosticWire[];
  readonly message: string;
}

function parseSearchProgress(params: unknown): ISearchProgress | undefined {
  if (typeof params !== 'object' || params === null || !('phase' in params)) {
    return undefined;
  }
  const { phase, detail } = params as { phase?: unknown; detail?: unknown };
  if (phase !== 'searching' && phase !== 'probing' && phase !== 'finished') {
    return undefined;
  }
  return { phase, ...(typeof detail === 'string' ? { detail } : {}) };
}

/**
 * {@link IToolchainService} 的 JSON-RPC 客户端代理。
 */
export class ToolchainServiceClient implements IToolchainService, IDisposable {
  private readonly _disposables = new DisposableStore();
  private readonly _onDidSearchProgress = new Emitter<ISearchProgress>();

  constructor(private readonly _channel: IChannel) {
    this._disposables.add(this._onDidSearchProgress);
    this._disposables.add(
      this._channel.listen(TOOLCHAIN_RPC_NOTIFICATIONS.searchProgress, (params) => {
        const progress = parseSearchProgress(params);
        if (progress !== undefined) {
          this._onDidSearchProgress.fire(progress);
        }
      }),
    );
  }

  get onDidSearchProgress(): Event<ISearchProgress> {
    return this._onDidSearchProgress.event;
  }

  getStatus(): Promise<IToolchainStatus> {
    return this._channel.call<IToolchainStatus>(TOOLCHAIN_RPC_METHODS.getStatus);
  }

  search(): Promise<IToolchainStatus> {
    return this._channel.call<IToolchainStatus>(TOOLCHAIN_RPC_METHODS.search);
  }

  async setDefaultStandard(standard: string): Promise<void> {
    await this._channel.call(TOOLCHAIN_RPC_METHODS.setDefaultStandard, { standard });
  }

  async compile(request: ICompileRequest): Promise<ICompileResult> {
    const wire = await this._channel.call<ICompileResultWire>(TOOLCHAIN_RPC_METHODS.compile, {
      uri: request.uri.toString(),
      content: request.content,
      standard: request.standard,
    });
    return { ...wire, diagnostics: wire.diagnostics.map(deserializeDiagnostic) };
  }

  run(uri: URI): Promise<IRunResult> {
    return this._channel.call<IRunResult>(TOOLCHAIN_RPC_METHODS.run, { uri: uri.toString() });
  }

  async check(uri: URI, content: string): Promise<readonly ICodeDiagnostic[]> {
    const wire = await this._channel.call<ICodeDiagnosticWire[]>(TOOLCHAIN_RPC_METHODS.check, {
      uri: uri.toString(),
      content,
    });
    return wire.map(deserializeDiagnostic);
  }

  dispose(): void {
    this._disposables.dispose();
  }
}
