import { useCallback, useEffect, useState } from "react";

import Icon from "../Icon";
import { listDir, type DirEntry } from "../../lib/fs";
import { useEditorStore } from "../../store/editor";

interface TreeNodeProps {
  entry: DirEntry;
  depth: number;
  isSelected: boolean;
  onSelect: (path: string) => void;
}

function TreeNode({ entry, depth, isSelected, onSelect }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    if (!entry.isDir) {
      onSelect(entry.path);
      return;
    }
    if (!expanded && children === null) {
      setLoading(true);
      try {
        setChildren(await listDir(entry.path));
      } catch {
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
    setExpanded((v) => !v);
  }, [entry, expanded, children, onSelect]);

  const indent = depth * 12;

  if (entry.isDir) {
    return (
      <div>
        <button
          type="button"
          onClick={toggle}
          className="rt-row flex w-full items-center gap-1.5 py-0.5 pr-2 text-left text-xs"
          style={{ paddingLeft: `${indent + 6}px` }}
        >
          {loading ? (
            <Icon name="sync" size={11} className="rt-text-faint shrink-0 animate-spin" />
          ) : (
            <Icon
              name={expanded ? "chevronDown" : "chevronRight"}
              size={11}
              className="rt-text-faint shrink-0"
            />
          )}
          <Icon
            name={expanded ? "folderOpen" : "folder"}
            size={13}
            className="rt-accent-text shrink-0"
          />
          <span className="truncate font-medium">{entry.name}</span>
        </button>
        {expanded && children !== null && (
          <div>
            {children.length === 0 ? (
              <div
                className="rt-text-faint py-0.5 text-[10px] italic"
                style={{ paddingLeft: `${indent + 30}px` }}
              >
                empty
              </div>
            ) : (
              children.map((child) => (
                <TreeNode
                  key={child.path}
                  entry={child}
                  depth={depth + 1}
                  isSelected={isSelected && child.path === child.path}
                  onSelect={onSelect}
                />
              ))
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`rt-row flex w-full items-center gap-1.5 py-0.5 pr-2 text-left text-xs ${
        isSelected ? "rt-btn-active" : ""
      }`}
      style={{ paddingLeft: `${indent + 24}px` }}
    >
      <Icon name="file" size={12} className="rt-row-icon shrink-0" />
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

export interface FileExplorerPanelProps {
  cwd: string | null;
}

export function FileExplorerPanel({ cwd }: FileExplorerPanelProps) {
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedPath = useEditorStore((s) => s.selectedPath);
  const openFile = useEditorStore((s) => s.openFile);

  useEffect(() => {
    if (!cwd) return;
    setEntries(null);
    setError(null);
    listDir(cwd)
      .then(setEntries)
      .catch((err) => setError(String(err)));
  }, [cwd]);

  return (
    <div className="rt-subsurface flex h-full w-full flex-col">
      <div className="rt-divider-b rt-text-muted flex items-center gap-1.5 px-2.5 py-1.5 text-xs">
        <Icon name="folder" size={13} className="rt-accent-text shrink-0" />
        <span className="truncate font-medium" title={cwd ?? undefined}>
          {cwd ? cwd.split("/").pop() || cwd : "No folder open"}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {!cwd ? (
          <div className="flex h-full items-center justify-center px-4 text-center">
            <p className="rt-text-muted text-xs leading-relaxed">
              Open a workspace folder to browse its files.
            </p>
          </div>
        ) : entries === null && !error ? (
          <div className="flex flex-col gap-1 p-2">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="rt-skeleton h-5 w-full rounded"
                style={{ width: `${60 + i * 10}%` }}
              />
            ))}
          </div>
        ) : error ? (
          <div className="px-3 py-2">
            <p className="rt-text-muted text-[11px] leading-snug">{error}</p>
          </div>
        ) : entries && entries.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center">
            <p className="rt-text-muted text-xs">Directory is empty.</p>
          </div>
        ) : (
          entries?.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              isSelected={selectedPath === entry.path}
              onSelect={openFile}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default FileExplorerPanel;
