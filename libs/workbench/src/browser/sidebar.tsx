import { onUnexpectedError } from '@oi/base';
import type { URI } from '@oi/base';
import type { IFileService, IFileSystemEntry } from '@oi/platform';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileLines, faFolder, faFolderOpen, faRotate } from '@fortawesome/free-solid-svg-icons';
import { useCallback, useEffect, useState } from 'react';
import { WORKBENCH_STRINGS } from './strings';

interface ITreeNodeProps {
  readonly entry: IFileSystemEntry;
  readonly depth: number;
  readonly fileService: IFileService;
  readonly onOpenFile: (uri: URI) => void;
}

function TreeNode({ entry, depth, fileService, onOpenFile }: ITreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<readonly IFileSystemEntry[] | undefined>(undefined);
  const isDirectory = entry.kind === 'directory';

  const handleClick = useCallback(async (): Promise<void> => {
    if (!isDirectory) {
      onOpenFile(entry.uri);
      return;
    }
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (children === undefined) {
      try {
        setChildren(await fileService.readDirectory(entry.uri));
      } catch (error) {
        onUnexpectedError(error);
        return;
      }
    }
    setExpanded(true);
  }, [children, entry.uri, expanded, fileService, isDirectory, onOpenFile]);

  return (
    <div className="oi-tree-node">
      <button
        type="button"
        className="oi-tree-row"
        style={{ paddingLeft: depth * 12 + 8 }}
        onClick={() => void handleClick()}
      >
        <span className="oi-tree-icon">
          <FontAwesomeIcon
            icon={isDirectory ? (expanded ? faFolderOpen : faFolder) : faFileLines}
            aria-hidden="true"
          />
        </span>
        <span className="oi-tree-name">{entry.name}</span>
      </button>
      {isDirectory && expanded
        ? children?.map((child) => (
            <TreeNode
              key={child.uri.toString()}
              entry={child}
              depth={depth + 1}
              fileService={fileService}
              onOpenFile={onOpenFile}
            />
          ))
        : null}
    </div>
  );
}

export interface IExplorerPanelProps {
  readonly rootUri: URI | undefined;
  readonly treeVersion: number;
  readonly fileService: IFileService;
  readonly hidden?: boolean;
  readonly onOpenFile: (uri: URI) => void;
  readonly onOpenFolder: () => void;
  readonly onRefresh: () => void;
}

/**
 * 资源管理器面板：目录树 + 打开文件夹 + 刷新（属于侧边栏二级视图）。
 */
export function ExplorerPanel({
  rootUri,
  treeVersion,
  fileService,
  hidden,
  onOpenFile,
  onOpenFolder,
  onRefresh,
}: IExplorerPanelProps) {
  const [rootEntries, setRootEntries] = useState<readonly IFileSystemEntry[]>([]);
  const [rootExpanded, setRootExpanded] = useState(true);

  useEffect(() => {
    if (!rootUri) {
      setRootEntries([]);
      return undefined;
    }
    let cancelled = false;
    fileService.readDirectory(rootUri).then(
      (entries) => {
        if (!cancelled) {
          setRootEntries(entries);
        }
      },
      (error: unknown) => {
        onUnexpectedError(error);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rootUri, treeVersion, fileService]);

  const rootName = rootUri?.path.split('/').pop();

  return (
    <section
      className="oi-panel oi-explorer"
      hidden={hidden}
      aria-label={WORKBENCH_STRINGS.explorer}
    >
      <div className="oi-sidebar-header">
        <span className="oi-sidebar-title">{WORKBENCH_STRINGS.explorer}</span>
        <span className="oi-sidebar-actions">
          <button
            type="button"
            className="oi-btn oi-btn-icon oi-btn-secondary"
            onClick={onOpenFolder}
            title={WORKBENCH_STRINGS.openFolderTooltip}
            aria-label={WORKBENCH_STRINGS.openFolder}
          >
            <FontAwesomeIcon icon={faFolderOpen} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="oi-btn oi-btn-icon oi-btn-secondary"
            onClick={onRefresh}
            disabled={rootUri === undefined}
            title={WORKBENCH_STRINGS.refreshTree}
            aria-label={WORKBENCH_STRINGS.refreshTree}
          >
            <FontAwesomeIcon icon={faRotate} aria-hidden="true" />
          </button>
        </span>
      </div>
      <div className="oi-tree">
        {rootUri === undefined ? (
          <p className="oi-sidebar-empty">{WORKBENCH_STRINGS.noFolder}</p>
        ) : (
          <>
            <button
              type="button"
              className="oi-tree-row"
              style={{ paddingLeft: 8 }}
              onClick={() => setRootExpanded((value) => !value)}
            >
              <span className="oi-tree-icon">
                <FontAwesomeIcon icon={rootExpanded ? faFolderOpen : faFolder} aria-hidden="true" />
              </span>
              <span className="oi-tree-name">{rootName ?? rootUri.path}</span>
            </button>
            {rootExpanded
              ? rootEntries.map((entry) => (
                  <TreeNode
                    key={entry.uri.toString()}
                    entry={entry}
                    depth={1}
                    fileService={fileService}
                    onOpenFile={onOpenFile}
                  />
                ))
              : null}
          </>
        )}
      </div>
    </section>
  );
}
