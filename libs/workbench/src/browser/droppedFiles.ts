/**
 * 拖放进编辑区的文件：判定与路径收集。
 *
 * 与 DOM 事件解耦成纯函数，方便单测；真实路径须经 preload 的
 * `webUtils.getPathForFile` 同步取得（Electron 32 起 `File.path` 已移除）。
 */

/** 拖拽载荷里是否含文件（编辑器内部拖文字不算）。 */
export function carriesFiles(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer !== null && Array.from(dataTransfer.types).includes('Files');
}

/** 取全部可解析的绝对路径；空路径与重复的跳过，保持拖放顺序。 */
export function droppedPaths(
  files: readonly File[],
  resolvePath: (file: File) => string,
): string[] {
  const paths: string[] = [];
  for (const file of files) {
    const path = resolvePath(file).trim();
    if (path.length > 0 && !paths.includes(path)) {
      paths.push(path);
    }
  }
  return paths;
}
