import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import electronPath from 'electron';
import { desktopDist, workspaceRoot } from './desktop-build.mjs';

/**
 * 便携式打包：Electron 运行时 + resources/app（构建产物），产物在 .gitignore 的 release/ 下。
 *
 * 运行时只在"版本变化"时整体重建；同版本重打时只补缺失或大小不符的文件。
 * 这样既不必每次删掉 280MB 运行时（Windows 上索引服务与杀软会短暂独占其中的文件，
 * 整体删除会 EBUSY 失败并把产物留在半成品状态），又能自愈上一次中断留下的缺文件。
 */
const electronDir = dirname(electronPath);
const releaseRoot = resolve(workspaceRoot, 'release/oi-code-win32-x64');
const markerFile = resolve(releaseRoot, '.electron-runtime-version');
const appDir = resolve(releaseRoot, 'resources/app');
const runtimePackage = {
  name: 'oi-code',
  productName: 'OI-Code',
  version: '0.1.0',
  main: 'main.cjs',
};

/** 打包后主程序改名，源文件名不再出现在产物里。 */
function targetOf(source) {
  const path = relative(electronDir, source);
  return path === 'electron.exe' ? resolve(releaseRoot, 'OI-Code.exe') : resolve(releaseRoot, path);
}

async function listFiles(directory, base = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path, base)));
    } else {
      files.push(path);
    }
  }
  return files;
}

async function exists(path) {
  return stat(path).then(
    () => true,
    () => false,
  );
}

function busyError(path, cause) {
  return new Error(
    `写入 ${path} 被其他进程占用。请关闭正在运行的 OI-Code 后重试；` +
      '若仍失败，多半是 Windows 搜索索引或杀软独占该文件，可把 release/ 加入其排除目录，或删除 release/ 后重新打包。',
    { cause },
  );
}

/** 覆盖写入；被占用时给出可操作的错误而不是半截产物。 */
async function writeFrom(source, target) {
  await mkdir(dirname(target), { recursive: true });
  try {
    await cp(source, target, { force: true });
  } catch (error) {
    if (['EBUSY', 'EPERM', 'ETXTBSY'].includes(error?.code)) {
      throw busyError(target, error);
    }
    throw error;
  }
}

/** 尽量清空产物目录；删不掉的（被系统独占的文件）留待逐文件覆盖时校验。 */
async function cleanTolerant(directory) {
  const leftovers = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      leftovers.push(...(await cleanTolerant(path)));
    }
    try {
      await rm(path, { recursive: true, force: true });
    } catch {
      leftovers.push(path);
    }
  }
  return leftovers;
}

const declaredVersion = (await readFile(resolve(electronDir, 'version'), 'utf8')).trim();
const previousVersion = (await readFile(markerFile, 'utf8').catch(() => '')).trim();
const sources = await listFiles(electronDir);
const exeTarget = resolve(releaseRoot, 'OI-Code.exe');
// 跨版本升级或产物不完整时才整体重建；同版本重打只补需要更新的文件
const needsFullRebuild = previousVersion !== declaredVersion || !(await exists(exeTarget));
const keepList = needsFullRebuild ? await cleanTolerant(releaseRoot) : [];
let copied = 0;
let reused = 0;

for (const source of sources) {
  const target = targetOf(source);
  const [sourceStat, targetStat] = await Promise.all([
    stat(source),
    stat(target).catch(() => undefined),
  ]);
  const identical = targetStat !== undefined && targetStat.size === sourceStat.size;
  if (!needsFullRebuild && identical) {
    reused += 1;
    continue;
  }
  if (needsFullRebuild && identical && keepList.includes(target)) {
    // 删不掉但与本次要写入的内容一致：保留即可，不必冒险覆盖
    reused += 1;
    continue;
  }
  await writeFrom(source, target);
  copied += 1;
}

// 构建产物每次都重写：这里只可能被关闭中的应用短暂占用
await rm(appDir, { recursive: true, force: true }).catch((error) => {
  throw busyError(appDir, error);
});
await mkdir(appDir, { recursive: true });
await writeFile(resolve(appDir, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`);
await cp(resolve(desktopDist, 'main.cjs'), resolve(appDir, 'main.cjs'));
await cp(resolve(desktopDist, 'preload.cjs'), resolve(appDir, 'preload.cjs'));
await cp(resolve(desktopDist, 'renderer'), resolve(appDir, 'renderer'), { recursive: true });
await writeFile(markerFile, `${declaredVersion}\n`);

const exe = await stat(resolve(releaseRoot, 'OI-Code.exe')).catch(() => undefined);
if (exe === undefined) {
  throw new Error('打包失败：产物里没有 OI-Code.exe');
}
process.stdout.write(
  `打包完成：release/oi-code-win32-x64/OI-Code.exe（Electron ${declaredVersion}，运行时复用 ${reused} 个、写入 ${copied} 个文件）\n`,
);
