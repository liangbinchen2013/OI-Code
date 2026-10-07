import { DisposableStore, Emitter, type Event, type IDisposable } from '@oi/base';
import type { IChannel } from './ipc/channel';
import { VJUDGE_RPC_METHODS, VJUDGE_RPC_NOTIFICATIONS } from './ipc/protocol';
import type {
  IVjudgeAccount,
  IVjudgeConfig,
  IVjudgeProblem,
  IVjudgeServiceClient,
  IVjudgeSolvedProblems,
  IVjudgeSubmission,
  IVjudgeSubmitRequest,
} from './vjudge';

function parseSubmission(params: unknown): IVjudgeSubmission | undefined {
  if (typeof params !== 'object' || params === null) {
    return undefined;
  }
  const { runId, oj, probNum, status, statusCanonical, processing } = params as Record<
    string,
    unknown
  >;
  if (
    typeof runId !== 'number' ||
    typeof oj !== 'string' ||
    typeof probNum !== 'string' ||
    typeof status !== 'string' ||
    typeof statusCanonical !== 'string' ||
    typeof processing !== 'boolean'
  ) {
    return undefined;
  }
  return params as IVjudgeSubmission;
}

/**
 * {@link IVjudgeServiceClient} 的 JSON-RPC 客户端代理：
 * 网络访问全部委托主进程，本类只做调用编组与判题更新事件分发。
 */
export class VjudgeServiceClient implements IVjudgeServiceClient, IDisposable {
  private readonly _disposables = new DisposableStore();
  private readonly _onDidSubmissionUpdate = new Emitter<IVjudgeSubmission>();

  constructor(private readonly _channel: IChannel) {
    this._disposables.add(this._onDidSubmissionUpdate);
    this._disposables.add(
      this._channel.listen(VJUDGE_RPC_NOTIFICATIONS.submissionUpdate, (params) => {
        const submission = parseSubmission(params);
        if (submission !== undefined) {
          this._onDidSubmissionUpdate.fire(submission);
        }
      }),
    );
  }

  get onDidSubmissionUpdate(): Event<IVjudgeSubmission> {
    return this._onDidSubmissionUpdate.event;
  }

  getConfig(): Promise<IVjudgeConfig> {
    return this._channel.call<IVjudgeConfig>(VJUDGE_RPC_METHODS.getConfig);
  }

  getAccount(): Promise<IVjudgeAccount> {
    return this._channel.call<IVjudgeAccount>(VJUDGE_RPC_METHODS.getAccount);
  }

  fetchProblem(oj: string, probNum: string, lang?: string): Promise<IVjudgeProblem> {
    return this._channel.call<IVjudgeProblem>(VJUDGE_RPC_METHODS.fetchProblem, {
      lang,
      oj,
      probNum,
    });
  }

  submit(request: IVjudgeSubmitRequest): Promise<number> {
    return this._channel.call<number>(VJUDGE_RPC_METHODS.submit, { ...request });
  }

  getSubmission(runId: number, showCode?: boolean): Promise<IVjudgeSubmission> {
    return this._channel.call<IVjudgeSubmission>(VJUDGE_RPC_METHODS.getSubmission, {
      runId,
      showCode,
    });
  }

  async watch(runId: number): Promise<void> {
    await this._channel.call(VJUDGE_RPC_METHODS.watch, { runId });
  }

  async unwatch(runId: number): Promise<void> {
    await this._channel.call(VJUDGE_RPC_METHODS.unwatch, { runId });
  }

  getSolvedProblems(username: string): Promise<IVjudgeSolvedProblems> {
    return this._channel.call<IVjudgeSolvedProblems>(VJUDGE_RPC_METHODS.getSolvedProblems, {
      username,
    });
  }

  dispose(): void {
    this._disposables.dispose();
  }
}
