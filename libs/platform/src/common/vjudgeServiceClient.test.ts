import { Emitter } from '@oi/base';
import { describe, expect, it } from 'vitest';
import { type IMessageTransport, RpcChannel } from './ipc/channel';
import { VJUDGE_RPC_METHODS, VJUDGE_RPC_NOTIFICATIONS } from './ipc/protocol';
import type { IVjudgeSubmission } from './vjudge';
import { VjudgeServiceClient } from './vjudgeServiceClient';

function createPipe(): [IMessageTransport, IMessageTransport] {
  const leftEmitter = new Emitter<unknown>();
  const rightEmitter = new Emitter<unknown>();
  const left: IMessageTransport = {
    onMessage: leftEmitter.event,
    send: (message) => queueMicrotask(() => rightEmitter.fire(message)),
  };
  const right: IMessageTransport = {
    onMessage: rightEmitter.event,
    send: (message) => queueMicrotask(() => leftEmitter.fire(message)),
  };
  return [left, right];
}

const pending: IVjudgeSubmission = {
  memoryKb: 0,
  oj: 'POJ',
  processing: true,
  probNum: '1182',
  remoteRunId: '25215486',
  runId: 73166362,
  runtimeMs: 0,
  status: 'Submitted',
  statusCanonical: 'PENDING',
};

describe('VjudgeServiceClient', () => {
  it('submit 编组请求参数并返回提交号', async () => {
    const [left, right] = createPipe();
    const client = new VjudgeServiceClient(new RpcChannel(left));
    const server = new RpcChannel(right);
    let received: unknown;
    server.registerMethod(VJUDGE_RPC_METHODS.submit, (params) => {
      received = params;
      return 73166362;
    });

    const runId = await client.submit({
      language: '0',
      method: 0,
      oj: 'POJ',
      open: 1,
      probNum: '1182',
      source: 'int main(){}',
    });

    expect(runId).toBe(73166362);
    expect(received).toMatchObject({ language: '0', oj: 'POJ', probNum: '1182' });

    client.dispose();
    server.dispose();
  });

  it('fetchProblem 与 getSubmission 走 RPC 并透传可选参数', async () => {
    const [left, right] = createPipe();
    const client = new VjudgeServiceClient(new RpcChannel(left));
    const server = new RpcChannel(right);
    server.registerMethod(VJUDGE_RPC_METHODS.fetchProblem, (params) => {
      expect(params).toEqual({ lang: 'ja', oj: 'POJ', probNum: '1182' });
      return { markdown: '# 题面', oj: 'POJ', probNum: '1182', problemId: 14789 };
    });
    server.registerMethod(VJUDGE_RPC_METHODS.getSubmission, (params) => {
      expect(params).toEqual({ runId: 73166362, showCode: true });
      return pending;
    });

    const problem = await client.fetchProblem('POJ', '1182', 'ja');
    const submission = await client.getSubmission(73166362, true);

    expect(problem.markdown).toBe('# 题面');
    expect(submission.statusCanonical).toBe('PENDING');

    client.dispose();
    server.dispose();
  });

  it('判题更新通知驱动事件，畸形通知被忽略', async () => {
    const [left, right] = createPipe();
    const client = new VjudgeServiceClient(new RpcChannel(left));
    const server = new RpcChannel(right);
    const updates: IVjudgeSubmission[] = [];
    client.onDidSubmissionUpdate((submission) => updates.push(submission));

    server.notify(VJUDGE_RPC_NOTIFICATIONS.submissionUpdate, pending);
    server.notify(VJUDGE_RPC_NOTIFICATIONS.submissionUpdate, { runId: '不是数字' });
    server.notify(VJUDGE_RPC_NOTIFICATIONS.submissionUpdate, null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updates).toHaveLength(1);
    expect(updates[0]?.processing).toBe(true);

    client.dispose();
    server.dispose();
  });

  it('watch / unwatch 透传提交号', async () => {
    const [left, right] = createPipe();
    const client = new VjudgeServiceClient(new RpcChannel(left));
    const server = new RpcChannel(right);
    const watched: unknown[] = [];
    server.registerMethod(VJUDGE_RPC_METHODS.watch, (params) => {
      watched.push(params);
      return null;
    });
    server.registerMethod(VJUDGE_RPC_METHODS.unwatch, (params) => {
      watched.push(params);
      return null;
    });

    await client.watch(123);
    await client.unwatch(123);

    expect(watched).toEqual([{ runId: 123 }, { runId: 123 }]);

    client.dispose();
    server.dispose();
  });
});
