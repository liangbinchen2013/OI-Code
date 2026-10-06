import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build as viteBuild } from 'vite';
import { buildMainProcesses, desktopDist, desktopRoot } from './desktop-build.mjs';

await rm(desktopDist, { recursive: true, force: true });
await buildMainProcesses();
await viteBuild({ configFile: resolve(desktopRoot, 'vite.config.ts') });

process.stdout.write('desktop 构建完成：dist/desktop\n');
