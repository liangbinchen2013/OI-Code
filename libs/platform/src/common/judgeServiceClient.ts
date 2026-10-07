import { DisposableStore, Emitter, type Event, type IDisposable, type URI } from '@oi/base';
import type { IChannel } from './ipc/channel';
import { JUDGE_RPC_METHODS, JUDGE_RPC_NOTIFICATIONS } from './ipc/protocol';
import type {
  IJudgeRequest,
  IJudgeResult,
  IJudgeServiceClient,
  IStressProgress,
  IStressRequest,
  IStressResult,
  ITestCase,
} from './judge';

function parseStressProgress(params: unknown): IStressProgress | undefined {
  if (typeof params !== 'object' || params === null) {
    return undefined;
  }
  const { phase, iteration, total } = params as {
    phase?: unknown;
    iteration?: unknown;
    total?: unknown;
  };
  if (
    (phase !== 'compiling' && phase !== 'running' && phase !== 'finished') ||
    typeof iteration !== 'number' ||
    typeof total !== 'number'
  ) {
    return undefined;
  }
  return { phase, iteration, total };
}

/**
 * {@link IJudgeServiceClient} 的 JSON-RPC 客户端代理。
 */
export class JudgeServiceClient implements IJudgeServiceClient, IDisposable {
  private readonly _disposables = new DisposableStore();
  private readonly _onDidStressProgress = new Emitter<IStressProgress>();

  constructor(private readonly _channel: IChannel) {
    this._disposables.add(this._onDidStressProgress);
    this._disposables.add(
      this._channel.listen(JUDGE_RPC_NOTIFICATIONS.stressProgress, (params) => {
        const progress = parseStressProgress(params);
        if (progress !== undefined) {
          this._onDidStressProgress.fire(progress);
        }
      }),
    );
  }

  get onDidStressProgress(): Event<IStressProgress> {
    return this._onDidStressProgress.event;
  }

  run(request: IJudgeRequest): Promise<IJudgeResult> {
    return this._channel.call<IJudgeResult>(JUDGE_RPC_METHODS.run, {
      content: request.content,
      language: request.language,
      timeLimitMs: request.timeLimitMs,
      memoryLimitMb: request.memoryLimitMb,
      cases: request.cases,
    });
  }

  stress(request: IStressRequest): Promise<IStressResult> {
    return this._channel.call<IStressResult>(JUDGE_RPC_METHODS.stress, {
      generatorUri: request.generatorUri.toString(),
      referenceUri: request.referenceUri.toString(),
      solutionUri: request.solutionUri.toString(),
      iterations: request.iterations,
      timeLimitMs: request.timeLimitMs,
    });
  }

  async cancelStress(): Promise<void> {
    await this._channel.call(JUDGE_RPC_METHODS.cancelStress);
  }

  importDirectory(uri: URI): Promise<readonly ITestCase[]> {
    return this._channel.call<ITestCase[]>(JUDGE_RPC_METHODS.importDirectory, {
      uri: uri.toString(),
    });
  }

  importArchive(uri: URI): Promise<readonly ITestCase[]> {
    return this._channel.call<ITestCase[]>(JUDGE_RPC_METHODS.importArchive, {
      uri: uri.toString(),
    });
  }

  dispose(): void {
    this._disposables.dispose();
  }
}
