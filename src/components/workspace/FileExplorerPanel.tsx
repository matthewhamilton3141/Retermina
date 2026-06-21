import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import Icon from "../Icon";
import {
  createDir,
  createFile,
  deletePath,
  listDir,
  renamePath,
  type DirEntry,
} from "../../lib/fs";
import { useEditorStore } from "../../store/editor";

// ---------------------------------------------------------------------------
// Context — shared state / handlers passed to every TreeNode without prop drilling
// ---------------------------------------------------------------------------

interface ExplorerCtx {
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  /** Path being renamed inline (null = none). */
  renamingPath: string | null;
  renameValue: string;
  setRenameValue: (v: string) => void;
  submitRename: (entry: DirEntry) => Promise<void>;
  cancelRename: () => void;
  /** Inline creation state (null = none). */
  creating: { parentPath: string; kind: "file" | "dir"; value: string } | null;
  setCreatingValue: (v: string) => void;
  submitCreating: () => Promise<void>;
  cancelCreating: () => void;
  /** Open the context menu for `entry` at cursor position. */
  openMenu: (e: React.MouseEvent, entry: DirEntry) => void;
}

const Ctx = createContext<ExplorerCtx | null>(null);
const useExplorer = () => useContext(Ctx)!;

// ---------------------------------------------------------------------------
// TreeNode
// ---------------------------------------------------------------------------

interface TreeNodeProps {
  entry: DirEntry;
  depth: number;
  refreshKey: number;
}

function TreeNode({ entry, depth, refreshKey }: TreeNodeProps) {
  const ctx = useExplorer();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const renameRef = useRef<HTMLInputElement | null>(null);
  const createRef = useRef<HTMLInputElement | null>(null);

  const isRenaming  = ctx.renamingPath === entry.path;
  const isCreating  = ctx.creating?.parentPath === entry.path;

  // Re-fetch children when the global refreshKey bumps (after any operation).
  useEffect(() => {
    if (expanded) {
      listDir(entry.path).then(setChildren).catch(() => setChildren([]));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Focus the rename input when it mounts.
  useEffect(() => {
    if (isRenaming) setTimeout(() => renameRef.current?.select(), 0);
  }, [isRenaming]);

  // Focus the create input when it mounts.
  useEffect(() => {
    if (isCreating && expanded) setTimeout(() => createRef.current?.focus(), 0);
  }, [isCreating, expanded]);

  // Auto-expand when a "new file/folder" creation targets this directory.
  useEffect(() => {
    if (isCreating && !expanded) {
      setExpanded(true);
      if (children === null) {
        listDir(entry.path).then(setChildren).catch(() => setChildren([]));
      }
    }
  }, [isCreating, expanded, children, entry.path]);

  const toggle = useCallback(async () => {
    if (!entry.isDir) {
      ctx.onSelectFile(entry.path);
      return;
    }
    if (!expanded && children === null) {
      setLoading(true);
      try { setChildren(await listDir(entry.path)); }
      catch { setChildren([]); }
      finally { setLoading(false); }
    }
    setExpanded((v) => !v);
  }, [entry, expanded, children, ctx]);

  const indent = depth * 12;

  const rowBase =
    "rt-row flex w-full items-center gap-1.5 py-0.5 pr-2 text-left text-xs";

  // ── Directory ──────────────────────────────────────────────────────────────
  if (entry.isDir) {
    return (
      <div>
        {isRenaming ? (
          <form
            onSubmit={(e) => { e.preventDefault(); void ctx.submitRename(entry); }}
            className={rowBase}
            style={{ paddingLeft: `${indent + 6}px` }}
          >
            <Icon name="folder" size={13} className="rt-accent-text shrink-0" />
            <input
              ref={renameRef}
              value={ctx.renameValue}
              onChange={(e) => ctx.setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") ctx.cancelRename(); }}
              onBlur={ctx.cancelRename}
              className="rt-input min-w-0 flex-1 px-1 py-0 text-xs"
              autoComplete="off"
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={toggle}
            onContextMenu={(e) => ctx.openMenu(e, entry)}
            className={rowBase}
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
        )}

        {expanded && (
          <div>
            {/* Inline creation input */}
            {isCreating && (
              <form
                onSubmit={(e) => { e.preventDefault(); void ctx.submitCreating(); }}
                className={`${rowBase} gap-1`}
                style={{ paddingLeft: `${indent + 24}px` }}
              >
                <Icon
                  name={ctx.creating!.kind === "dir" ? "folder" : "file"}
                  size={12}
                  className="rt-accent-text shrink-0"
                />
                <input
                  ref={createRef}
                  value={ctx.creating!.value}
                  onChange={(e) => ctx.setCreatingValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") ctx.cancelCreating(); }}
                  onBlur={ctx.cancelCreating}
                  className="rt-input min-w-0 flex-1 px-1 py-0 text-xs"
                  autoComplete="off"
                  placeholder={ctx.creating!.kind === "dir" ? "folder-name" : "file.txt"}
                />
              </form>
            )}

            {children === null ? null : children.length === 0 && !isCreating ? (
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
                  refreshKey={refreshKey}
                />
              ))
            )}
          </div>
        )}
      </div>
    );
  }

  // ── File ───────────────────────────────────────────────────────────────────
  const isSelected = ctx.selectedPath === entry.path;

  if (isRenaming) {
    return (
      <form
        onSubmit={(e) => { e.preventDefault(); void ctx.submitRename(entry); }}
        className={`${rowBase} ${isSelected ? "rt-btn-active" : ""}`}
        style={{ paddingLeft: `${indent + 24}px` }}
      >
        <Icon name="file" size={12} className="rt-row-icon shrink-0" />
        <input
          ref={renameRef}
          value={ctx.renameValue}
          onChange={(e) => ctx.setRenameValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") ctx.cancelRename(); }}
          onBlur={ctx.cancelRename}
          className="rt-input min-w-0 flex-1 px-1 py-0 text-xs"
          autoComplete="off"
        />
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      onContextMenu={(e) => ctx.openMenu(e, entry)}
      className={`${rowBase} ${isSelected ? "rt-btn-active" : ""}`}
      style={{ paddingLeft: `${indent + 24}px` }}
    >
      <Icon name="file" size={12} className="rt-row-icon shrink-0" />
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

interface MenuState {
  x: number;
  y: number;
  entry: DirEntry;
}

interface ContextMenuProps {
  menu: MenuState;
  onClose: () => void;
  onRename: (entry: DirEntry) => void;
  onDelete: (entry: DirEntry) => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
}

function ContextMenu({ menu, onClose, onRename, onDelete, onNewFile, onNewFolder }: ContextMenuProps) {
  const { entry } = menu;

  function item(label: string, icon: Parameters<typeof Icon>[0]["name"], action: () => void, danger = false) {
    return (
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); action(); onClose(); }}
        className={`rt-menu-item flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm ${
          danger ? "text-red-500 hover:bg-red-500/10" : ""
        }`}
      >
        <Icon name={icon} size={13} className="shrink-0" />
        {label}
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={onClose} />
      <div
        className="rt-menu fixed z-[61] min-w-[160px] py-1"
        style={{ left: menu.x, top: menu.y }}
      >
        {entry.isDir ? (
          <>
            {item("New File", "newFile", () => onNewFile(entry.path))}
            {item("New Folder", "newFolder", () => onNewFolder(entry.path))}
            <div className="rt-divider my-1 h-px mx-1" />
            {item("Rename", "file", () => onRename(entry))}
            <div className="rt-divider my-1 h-px mx-1" />
            {item("Delete", "trash", () => onDelete(entry), true)}
          </>
        ) : (
          <>
            {item("Open", "code", () => {})}
            <div className="rt-divider my-1 h-px mx-1" />
            {item("Rename", "file", () => onRename(entry))}
            <div className="rt-divider my-1 h-px mx-1" />
            {item("Delete", "trash", () => onDelete(entry), true)}
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export interface FileExplorerPanelProps {
  cwd: string | null;
}

export function FileExplorerPanel({ cwd }: FileExplorerPanelProps) {
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const selectedPath = useEditorStore((s) => s.selectedPath);
  const openFile     = useEditorStore((s) => s.openFile);

  const [menuState, setMenuState]     = useState<MenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue]   = useState("");
  const [creating, setCreating] = useState<{
    parentPath: string;
    kind: "file" | "dir";
    value: string;
  } | null>(null);

  const refresh = useCallback(() => {
    if (!cwd) return;
    setEntries(null);
    setError(null);
    listDir(cwd)
      .then((data) => { setEntries(data); setRefreshKey((k) => k + 1); })
      .catch((err) => setError(String(err)));
  }, [cwd]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Context menu handlers ─────────────────────────────────────────────────

  const openMenu = useCallback((e: React.MouseEvent, entry: DirEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuState({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const startRename = useCallback((entry: DirEntry) => {
    setMenuState(null);
    setRenamingPath(entry.path);
    setRenameValue(entry.name);
  }, []);

  const submitRename = useCallback(async (entry: DirEntry) => {
    const newName = renameValue.trim();
    if (!newName || newName === entry.name) { setRenamingPath(null); return; }
    const parent = entry.path.split("/").slice(0, -1).join("/");
    const newPath = `${parent}/${newName}`;
    try {
      await renamePath(entry.path, newPath);
      setRenamingPath(null);
      refresh();
    } catch (err) {
      console.error(err);
      setRenamingPath(null);
    }
  }, [renameValue, refresh]);

  const handleDelete = useCallback(async (entry: DirEntry) => {
    setMenuState(null);
    if (!window.confirm(`Delete "${entry.name}"?`)) return;
    try { await deletePath(entry.path); refresh(); }
    catch (err) { console.error(err); }
  }, [refresh]);

  const startNewFile   = useCallback((parentPath: string) => {
    setMenuState(null);
    setCreating({ parentPath, kind: "file", value: "" });
  }, []);

  const startNewFolder = useCallback((parentPath: string) => {
    setMenuState(null);
    setCreating({ parentPath, kind: "dir", value: "" });
  }, []);

  const submitCreating = useCallback(async () => {
    if (!creating) return;
    const name = creating.value.trim();
    if (!name) { setCreating(null); return; }
    const fullPath = `${creating.parentPath}/${name}`;
    try {
      if (creating.kind === "dir") await createDir(fullPath);
      else await createFile(fullPath);
      setCreating(null);
      refresh();
    } catch (err) {
      console.error(err);
      setCreating(null);
    }
  }, [creating, refresh]);

  // ── Context value ─────────────────────────────────────────────────────────

  const ctxValue: ExplorerCtx = {
    selectedPath,
    onSelectFile: openFile,
    renamingPath,
    renameValue,
    setRenameValue,
    submitRename,
    cancelRename: () => setRenamingPath(null),
    creating,
    setCreatingValue: (v) => setCreating((s) => s && { ...s, value: v }),
    submitCreating,
    cancelCreating: () => setCreating(null),
    openMenu,
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Ctx.Provider value={ctxValue}>
      <div className="rt-subsurface flex h-full w-full flex-col">
        <div className="rt-divider-b rt-text-muted flex items-center gap-1.5 px-2.5 py-1.5 text-xs">
          <Icon name="folder" size={13} className="rt-accent-text shrink-0" />
          <span className="truncate font-medium flex-1" title={cwd ?? undefined}>
            {cwd ? cwd.split("/").pop() || cwd : "No folder open"}
          </span>
          {cwd && (
            <button
              type="button"
              onClick={refresh}
              title="Refresh"
              className="rt-btn flex h-5 w-5 shrink-0 items-center justify-center"
            >
              <Icon name="sync" size={11} aria-label="Refresh" />
            </button>
          )}
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
                <div key={i} className="rt-skeleton h-5 rounded" style={{ width: `${60 + i * 10}%` }} />
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
                refreshKey={refreshKey}
              />
            ))
          )}
        </div>
      </div>

      {menuState && (
        <ContextMenu
          menu={menuState}
          onClose={() => setMenuState(null)}
          onRename={startRename}
          onDelete={handleDelete}
          onNewFile={startNewFile}
          onNewFolder={startNewFolder}
        />
      )}
    </Ctx.Provider>
  );
}

export default FileExplorerPanel;
