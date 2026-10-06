import { describe, expect, it } from 'vitest';
import { runProcess } from './processRunner';

function runNode(
  script: string,
  timeoutMs?: number,
): Promise<Awaited<ReturnType<typeof runProcess>>> {
  return runProcess(process.execPath, ['-e', script], timeoutMs === undefined ? {} : { timeoutMs });
}

describe('runProcess', () => {
  it('收集 stdout/stderr 与退出码', async () => {
    const result = await runNode(
      "process.stdout.write('out'); process.stderr.write('err'); process.exit(5);",
    );

    expect(result.exitCode).toBe(5);
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
    expect(result.timedOut).toBe(false);
  });

  it('写入 stdin 并回传结果', async () => {
    const result = await runProcess(
      process.execPath,
      ['-e', 'process.stdin.on("data", (c) => process.stdout.write(c))'],
      { stdin: '你好' },
    );

    expect(result.stdout).toBe('你好');
  });

  it('超时强杀并标记 timedOut', async () => {
    const result = await runNode('setTimeout(() => undefined, 60000);', 500);

    expect(result.timedOut).toBe(true);
  });

  it('命令不存在时返回 errorMessage', async () => {
    const result = await runProcess('definitely-not-a-real-command-oi-code', []);

    expect(result.exitCode).toBeNull();
    expect(result.errorMessage).toBeDefined();
  });

  it('按块回调输出', async () => {
    const chunks: string[] = [];
    await runProcess(
      process.execPath,
      ['-e', "process.stdout.write('a'); setTimeout(() => process.stdout.write('b'), 20);"],
      { onStdout: (chunk) => chunks.push(chunk) },
    );

    expect(chunks.join('')).toBe('ab');
    expect(chunks.length).toBeGreaterThan(0);
  });
});
