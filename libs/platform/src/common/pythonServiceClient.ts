import { DisposableStore, Emitter, type Event, type IDisposable, type URI } from '@oi/base';
import {
  deserializeDiagnostic,
  type ICodeDiagnostic,
  type ICodeDiagnosticWire,
} from './diagnostics';
import type { IChannel } from './ipc/channel';
import { PYTHON_RPC_METHODS, PYTHON_RPC_NOTIFICATIONS } from './ipc/protocol';
import type {
  IPipInstallRequest,
  IPipInstallResult,
  IPipOutputChunk,
  IPythonServiceClient,
  IPythonStatus,
} from './python';
import type { IRunResult } from './runner';
import type { ISearchProgress } from './toolchain';

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

function parsePipOutput(params: unknown): IPipOutputChunk | undefined {
  if (typeof params !== 'object' || params === null) {
    return undefined;
  }
  const { stream, chunk } = params as { stream?: unknown; chunk?: unknown };
  if ((stream !== 'stdout' && stream !== 'stderr') || typeof chunk !== 'string') {
    return undefined;
  }
  return { stream, chunk };
}

/**
 * {@link IPythonService} 的 JSON-RPC 客户端代理。
 */
export class PythonServiceClient implements IPythonServiceClient, IDisposable {
  private readonly _disposables = new DisposableStore();
  private readonly _onDidSearchProgress = new Emitter<ISearchProgress>();
  private readonly _onDidPipOutput = new Emitter<IPipOutputChunk>();

  constructor(private readonly _channel: IChannel) {
    this._disposables.add(this._onDidSearchProgress);
    this._disposables.add(this._onDidPipOutput);
    this._disposables.add(
      this._channel.listen(PYTHON_RPC_NOTIFICATIONS.searchProgress, (params) => {
        const progress = parseSearchProgress(params);
        if (progress !== undefined) {
          this._onDidSearchProgress.fire(progress);
        }
      }),
    );
    this._disposables.add(
      this._channel.listen(PYTHON_RPC_NOTIFICATIONS.pipOutput, (params) => {
        const output = parsePipOutput(params);
        if (output !== undefined) {
          this._onDidPipOutput.fire(output);
        }
      }),
    );
  }

  get onDidSearchProgress(): Event<ISearchProgress> {
    return this._onDidSearchProgress.event;
  }

  get onDidPipOutput(): Event<IPipOutputChunk> {
    return this._onDidPipOutput.event;
  }

  getStatus(): Promise<IPythonStatus> {
    return this._channel.call<IPythonStatus>(PYTHON_RPC_METHODS.getStatus);
  }

  search(): Promise<IPythonStatus> {
    return this._channel.call<IPythonStatus>(PYTHON_RPC_METHODS.search);
  }

  async setDefaultInterpreter(path: string): Promise<void> {
    await this._channel.call(PYTHON_RPC_METHODS.setDefaultInterpreter, { path });
  }

  pipInstall(request: IPipInstallRequest): Promise<IPipInstallResult> {
    return this._channel.call<IPipInstallResult>(PYTHON_RPC_METHODS.pipInstall, request);
  }

  run(uri: URI): Promise<IRunResult> {
    return this._channel.call<IRunResult>(PYTHON_RPC_METHODS.run, { uri: uri.toString() });
  }

  async check(uri: URI, content: string): Promise<readonly ICodeDiagnostic[]> {
    const wire = await this._channel.call<ICodeDiagnosticWire[]>(PYTHON_RPC_METHODS.check, {
      uri: uri.toString(),
      content,
    });
    return wire.map(deserializeDiagnostic);
  }

  dispose(): void {
    this._disposables.dispose();
  }
}
