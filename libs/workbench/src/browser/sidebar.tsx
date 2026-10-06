import { onUnexpectedError } from '@oi/base';
import type { URI } from '@oi/base';
import type { IFileService, IFileSystemEntry } from '@oi/platform';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFileLines,
  faFolder,
  faFolderOpen,
  faGear,
  faRotate,
} from '@fortawesome/free-solid-svg-icons';
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

export interface ISidebarProps {
  readonly rootUri: URI | undefined;
  readonly treeVersion: number;
  readonly fileService: IFileService;
  readonly settingsActive: boolean;
  readonly onOpenFile: (uri: URI) => void;
  readonly onOpenFolder: () => void;
  readonly onRefresh: () => void;
  readonly onOpenSettings: () => void;
}

/**
 * 左侧资源管理器：目录树 + 打开文件夹 + 底部设置入口。
 */
export function Sidebar({
  rootUri,
  treeVersion,
  fileService,
  settingsActive,
  onOpenFile,
  onOpenFolder,
  onRefresh,
  onOpenSettings,
}: ISidebarProps) {
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
    <aside className="oi-sidebar">
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
      <div className="oi-sidebar-footer">
        <button
          type="button"
          className={`oi-sidebar-settings${settingsActive ? ' oi-sidebar-settings-active' : ''}`}
          onClick={onOpenSettings}
        >
          <FontAwesomeIcon icon={faGear} aria-hidden="true" />
          <span>{WORKBENCH_STRINGS.settings}</span>
        </button>
      </div>
    </aside>
  );
}
