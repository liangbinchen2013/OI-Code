import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import electronPath from 'electron';
import { desktopDist, workspaceRoot } from './desktop-build.mjs';

// 便携式打包：Electron 运行时 + resources/app（构建产物），产物在 .gitignore 的 release/ 下
const electronDir = dirname(electronPath);
const releaseRoot = resolve(workspaceRoot, 'release/oi-code-win32-x64');
const runtimePackage = {
  name: 'oi-code',
  productName: 'OI-Code',
  version: '0.1.0',
  main: 'main.cjs',
};

await rm(releaseRoot, { recursive: true, force: true });
await cp(electronDir, releaseRoot, { recursive: true });
await rename(resolve(releaseRoot, 'electron.exe'), resolve(releaseRoot, 'OI-Code.exe'));

const appDir = resolve(releaseRoot, 'resources/app');
await mkdir(appDir, { recursive: true });
await writeFile(resolve(appDir, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`);
await cp(resolve(desktopDist, 'main.cjs'), resolve(appDir, 'main.cjs'));
await cp(resolve(desktopDist, 'preload.cjs'), resolve(appDir, 'preload.cjs'));
await cp(resolve(desktopDist, 'renderer'), resolve(appDir, 'renderer'), { recursive: true });

process.stdout.write('打包完成：release/oi-code-win32-x64/OI-Code.exe\n');
