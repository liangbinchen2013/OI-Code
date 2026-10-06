import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import electronPath from 'electron';
import { createServer } from 'vite';
import { buildMainProcesses, desktopDist, desktopRoot } from './desktop-build.mjs';

await buildMainProcesses();

const server = await createServer({ configFile: resolve(desktopRoot, 'vite.config.ts') });
await server.listen();

const devServerUrl = server.resolvedUrls?.local[0];
if (!devServerUrl) {
  throw new Error('Vite 开发服务器未返回本地地址');
}
process.stdout.write(`渲染进程开发服务器：${devServerUrl}\n`);

const electronProcess = spawn(electronPath, [resolve(desktopDist, 'main.cjs')], {
  env: { ...process.env, OI_CODE_DEV_SERVER_URL: devServerUrl },
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    electronProcess.kill();
  });
}

electronProcess.on('exit', (code) => {
  server.close().finally(() => {
    process.exit(code ?? 0);
  });
});
