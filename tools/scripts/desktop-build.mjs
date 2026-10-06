import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const desktopRoot = resolve(workspaceRoot, 'apps/desktop');
export const desktopDist = resolve(workspaceRoot, 'dist/desktop');

/**
 * 用 esbuild 打包 Electron 主进程与 preload（AGENTS.md 的 prod 构建选型）。
 */
export async function buildMainProcesses(options = {}) {
  const common = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
    sourcemap: options.sourcemap ?? true,
    tsconfig: resolve(desktopRoot, 'tsconfig.json'),
    logLevel: 'warning',
  };
  await build({
    ...common,
    entryPoints: [resolve(desktopRoot, 'src/main/index.ts')],
    outfile: resolve(desktopDist, 'main.cjs'),
  });
  await build({
    ...common,
    entryPoints: [resolve(desktopRoot, 'src/preload/index.ts')],
    outfile: resolve(desktopDist, 'preload.cjs'),
  });
}
