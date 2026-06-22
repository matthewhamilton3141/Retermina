import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import Icon from "../Icon";
import FloatingMenu from "../FloatingMenu";
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
// Context
// ---------------------------------------------------------------------------

interface ExplorerCtx {
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  renamingPath: string | null;
  renameValue: string;
  setRenameValue: (v: string) => void;
  submitRename: (entry: DirEntry) => Promise<void>;
  cancelRename: () => void;
  creating: { parentPath: string; kind: "file" | "dir"; value: string } | null;
  setCreatingValue: (v: string) => void;
  submitCreating: () => Promise<void>;
  cancelCreating: () => void;
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

  const isRenaming = ctx.renamingPath === entry.path;
  const isCreating = ctx.creating?.parentPath === entry.path;

  // Re-fetch children when the global refreshKey bumps.
  useEffect(() => {
    if (expanded) {
      listDir(entry.path).then(setChildren).catch(() => setChildren([]));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    if (isRenaming) setTimeout(() => renameRef.current?.select(), 0);
  }, [isRenaming]);

  useEffect(() => {
    if (isCreating && expanded) setTimeout(() => createRef.current?.focus(), 0);
  }, [isCreating, expanded]);

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
  const rowBase = "rt-row flex w-full items-center gap-1.5 py-0.5 pr-2 text-left text-xs";

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

interface MenuState { x: number; y: number; entry: DirEntry; }

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
    <FloatingMenu x={menu.x} y={menu.y} onClose={onClose} className="min-w-[160px] py-1">
      {entry.isDir ? (
        <>
          {item("New File", "newFile", () => onNewFile(entry.path))}
          {item("New Folder", "newFolder", () => onNewFolder(entry.path))}
          <div className="rt-divider my-1 mx-1 h-px" />
          {item("Rename", "file", () => onRename(entry))}
          <div className="rt-divider my-1 mx-1 h-px" />
          {item("Delete", "trash", () => onDelete(entry), true)}
        </>
      ) : (
        <>
          {item("Open", "code", () => {})}
          <div className="rt-divider my-1 mx-1 h-px" />
          {item("Rename", "file", () => onRename(entry))}
          <div className="rt-divider my-1 mx-1 h-px" />
          {item("Delete", "trash", () => onDelete(entry), true)}
        </>
      )}
    </FloatingMenu>
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

  const [menuState, setMenuState]       = useState<MenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue]   = useState("");
  const [creating, setCreating]         = useState<{
    parentPath: string;
    kind: "file" | "dir";
    value: string;
  } | null>(null);

  const createInputRef = useRef<HTMLInputElement>(null);

  // Full refresh — reloads root entries and bumps refreshKey so all expanded
  // TreeNodes re-fetch their children.
  const refresh = useCallback(() => {
    if (!cwd) return;
    setError(null);
    listDir(cwd)
      .then((data) => {
        setEntries(data);
        setRefreshKey((k) => k + 1);
      })
      .catch((err) => setError(String(err)));
  }, [cwd]);

  // Silent poll — compares listings without clearing UI state.
  // Detects files created externally (terminal, LaunchHub new-file, etc.).
  const silentRefresh = useCallback(async () => {
    if (!cwd) return;
    try {
      const data = await listDir(cwd);
      setEntries((prev) => {
        const prevSig = prev?.map((e) => e.path).join("\0") ?? "";
        const nextSig = data.map((e) => e.path).join("\0");
        if (prevSig === nextSig) return prev;
        setRefreshKey((k) => k + 1);
        return data;
      });
    } catch {
      // ignore transient poll errors
    }
  }, [cwd]);

  // Initial load.
  useEffect(() => { refresh(); }, [refresh]);

  // Poll every 3 s for external changes.
  useEffect(() => {
    if (!cwd) return;
    const id = window.setInterval(() => void silentRefresh(), 3000);
    return () => window.clearInterval(id);
  }, [cwd, silentRefresh]);

  // Refresh on window focus (e.g. user created a file in another app).
  useEffect(() => {
    const onFocus = () => void silentRefresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [silentRefresh]);

  // Focus the root-level create input when it mounts.
  useEffect(() => {
    if (creating?.parentPath === cwd) {
      setTimeout(() => createInputRef.current?.focus(), 0);
    }
  }, [creating, cwd]);

  // ── Handlers ──────────────────────────────────────────────────────────────

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
    try {
      await renamePath(entry.path, `${parent}/${newName}`);
      setRenamingPath(null);
      refresh();
    } catch {
      setRenamingPath(null);
    }
  }, [renameValue, refresh]);

  const handleDelete = useCallback(async (entry: DirEntry) => {
    setMenuState(null);
    if (!window.confirm(`Delete "${entry.name}"?`)) return;
    try { await deletePath(entry.path); refresh(); }
    catch { /* ignore */ }
  }, [refresh]);

  const startNewFile = useCallback((parentPath: string) => {
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
    } catch {
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

  const rootIsCreating = creating?.parentPath === cwd;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Ctx.Provider value={ctxValue}>
      <div className="rt-subsurface flex h-full w-full flex-col">

        {/* Header toolbar */}
        <div className="rt-divider-b rt-text-muted flex items-center gap-1 px-2.5 py-1.5 text-xs">
          <Icon name="folder" size={13} className="rt-accent-text shrink-0" />
          <span className="min-w-0 flex-1 truncate font-medium" title={cwd ?? undefined}>
            {cwd ? cwd.split("/").pop() || cwd : "No folder open"}
          </span>
          {cwd && (
            <>
              <button
                type="button"
                onClick={() => startNewFile(cwd)}
                title="New File"
                className="rt-btn flex h-5 w-5 shrink-0 items-center justify-center"
              >
                <Icon name="newFile" size={12} aria-label="New File" />
              </button>
              <button
                type="button"
                onClick={() => startNewFolder(cwd)}
                title="New Folder"
                className="rt-btn flex h-5 w-5 shrink-0 items-center justify-center"
              >
                <Icon name="newFolder" size={12} aria-label="New Folder" />
              </button>
              <button
                type="button"
                onClick={refresh}
                title="Refresh"
                className="rt-btn flex h-5 w-5 shrink-0 items-center justify-center"
              >
                <Icon name="sync" size={11} aria-label="Refresh" />
              </button>
            </>
          )}
        </div>

        {/* File tree */}
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {!cwd ? (
            <div className="flex h-full items-center justify-center px-4 text-center">
              <p className="rt-text-muted text-xs leading-relaxed">
                Open a workspace folder to browse its files.
              </p>
            </div>
          ) : error ? (
            <div className="px-3 py-2">
              <p className="rt-text-muted text-[11px] leading-snug">{error}</p>
            </div>
          ) : entries === null ? (
            <div className="flex flex-col gap-1 p-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="rt-skeleton h-5 rounded" style={{ width: `${60 + i * 10}%` }} />
              ))}
            </div>
          ) : (
            <>
              {/* Root-level inline creation (triggered by header buttons) */}
              {rootIsCreating && (
                <form
                  onSubmit={(e) => { e.preventDefault(); void submitCreating(); }}
                  className="flex items-center gap-1.5 py-0.5 pl-3 pr-2 text-xs"
                >
                  <Icon
                    name={creating!.kind === "dir" ? "folder" : "file"}
                    size={12}
                    className="rt-accent-text shrink-0"
                  />
                  <input
                    ref={createInputRef}
                    value={creating!.value}
                    onChange={(e) => setCreating((s) => s && { ...s, value: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Escape") setCreating(null); }}
                    onBlur={() => setCreating(null)}
                    className="rt-input min-w-0 flex-1 px-1 py-0 text-xs"
                    autoComplete="off"
                    placeholder={creating!.kind === "dir" ? "folder-name" : "file.txt"}
                  />
                </form>
              )}

              {entries.length === 0 && !rootIsCreating ? (
                <div className="flex h-full items-center justify-center px-4 text-center">
                  <p className="rt-text-muted text-xs">Directory is empty.</p>
                </div>
              ) : (
                entries.map((entry) => (
                  <TreeNode
                    key={entry.path}
                    entry={entry}
                    depth={0}
                    refreshKey={refreshKey}
                  />
                ))
              )}
            </>
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
