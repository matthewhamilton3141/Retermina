import { useEffect, useState } from "react";

import Icon from "../Icon";
import { useRecentStore } from "../../store/recent";
import { getRecentWorkspaces } from "../../lib/recentWorkspaces";
import { parentDir } from "../../lib/format";

export interface RecentWorkspacesPanelProps {
  onOpen?: (path: string) => void;
}

/** Strip trailing slashes so "/a/b/" and "/a/b" dedupe to the same key. */
function normalizePath(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

export function RecentWorkspacesPanel({ onOpen }: RecentWorkspacesPanelProps) {
  const entries = useRecentStore((s) => s.entries);
  const remove  = useRecentStore((s) => s.remove);
  const clear   = useRecentStore((s) => s.clear);

  // Editor history (VSCode/Cursor/VSCodium) surfaced alongside our own recents.
  // Scoped to existing folders — the clean match for "Recent Workspaces".
  const [editorFolders, setEditorFolders] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    getRecentWorkspaces(20).then((items) => {
      if (!active) return;
      setEditorFolders(
        items
          .filter((it) => it.kind === "folder" && it.exists)
          .map((it) => it.path),
      );
    });
    return () => {
      active = false;
    };
  }, []);

  // Local recents win on conflict; editor entries fill in the rest, deduped
  // against the local set and against each other by normalized path.
  const seen = new Set(entries.map((e) => normalizePath(e.path)));
  const editorOnly: string[] = [];
  for (const path of editorFolders) {
    const key = normalizePath(path);
    if (seen.has(key)) continue;
    seen.add(key);
    editorOnly.push(path);
  }

  const isEmpty = entries.length === 0 && editorOnly.length === 0;

  return (
    <section className="w-full">
      <div className="mb-3 flex items-center">
        <h2 className="rt-text-muted text-xs font-semibold uppercase tracking-wider flex-1">
          Recent Workspaces
        </h2>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={clear}
            className="rt-btn px-1.5 py-0.5 text-[11px]"
            title="Clear history"
          >
            Clear
          </button>
        )}
      </div>

      {isEmpty ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-0.5">
          {entries.map((entry) => (
            <li key={entry.path} className="group/row flex items-center">
              <button
                type="button"
                onClick={() => onOpen?.(entry.path)}
                title={entry.path}
                className="rt-row flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
              >
                <Icon name="folder" size={18} className="rt-row-icon shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {entry.name}
                  </span>
                  <span className="rt-text-muted block truncate text-xs">
                    {parentDir(entry.path)}
                  </span>
                </span>
                <span className="rt-text-faint shrink-0 text-[10px]">
                  {formatAge(entry.openedAt)}
                </span>
              </button>
              {/* Remove button — visible on row hover */}
              <button
                type="button"
                onClick={() => remove(entry.path)}
                title="Remove from history"
                className="rt-btn mr-1 flex h-6 w-6 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover/row:opacity-100"
              >
                <Icon name="close" size={11} aria-label="Remove" />
              </button>
            </li>
          ))}

          {/* Editor history — entries not already in our own recents. These
              aren't ours to delete, so they have no remove button; opening one
              records it into local recents (via openTerminal). */}
          {editorOnly.map((path) => {
            const name = normalizePath(path).split("/").pop() || path;
            return (
              <li key={`editor:${path}`} className="flex items-center">
                <button
                  type="button"
                  onClick={() => onOpen?.(path)}
                  title={path}
                  className="rt-row flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
                >
                  <Icon name="folder" size={18} className="rt-row-icon shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {name}
                    </span>
                    <span className="rt-text-muted block truncate text-xs">
                      {parentDir(path)}
                    </span>
                  </span>
                  <span className="rt-text-faint shrink-0 text-[9px] font-semibold uppercase tracking-wide">
                    Editor
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Human-readable relative age: "just now", "5m ago", "3h ago", "2d ago". */
function formatAge(openedAt: number): string {
  const diff = Date.now() - openedAt;
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);

  if (mins  <  1) return "just now";
  if (hours <  1) return `${mins}m ago`;
  if (days  <  1) return `${hours}h ago`;
  if (days  < 30) return `${days}d ago`;
  return new Date(openedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function EmptyState() {
  return (
    <div className="rt-empty flex flex-col items-center gap-2 px-4 py-8 text-center">
      <Icon name="folder" size={22} className="rt-text-faint" />
      <p className="rt-text-muted text-sm">No recent workspaces</p>
      <p className="rt-text-faint max-w-xs text-xs">
        Folders you open will appear here.
      </p>
    </div>
  );
}

export default RecentWorkspacesPanel;
