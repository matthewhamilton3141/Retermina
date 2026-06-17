import { useEffect, useState } from "react";

import Icon, { type IconName } from "../Icon";
import { getRecentWorkspaces } from "../../lib/tauri";
import { parentDir } from "../../lib/format";
import type { RecentKind, RecentWorkspace } from "../../types";

const KIND_ICON: Record<RecentKind, IconName> = {
  folder: "folder",
  file: "file",
  workspace: "files",
};

export interface RecentWorkspacesPanelProps {
  onOpen?: (workspace: RecentWorkspace) => void;
}

export function RecentWorkspacesPanel({ onOpen }: RecentWorkspacesPanelProps) {
  // `null` = still loading; `[]` = loaded but empty.
  const [items, setItems] = useState<RecentWorkspace[] | null>(null);

  useEffect(() => {
    let active = true;
    getRecentWorkspaces(10).then((data) => {
      if (active) setItems(data);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="w-full">
      <h2 className="rt-text-muted mb-3 text-xs font-semibold uppercase tracking-wider">
        Recent Workspaces
      </h2>

      {items === null ? (
        <LoadingRows />
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-0.5">
          {items.map((ws) => (
            <li key={`${ws.kind}:${ws.path}`}>
              <button
                type="button"
                onClick={() => onOpen?.(ws)}
                disabled={!ws.exists}
                title={ws.path}
                className="rt-row group flex w-full items-center gap-3 px-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon
                  name={KIND_ICON[ws.kind]}
                  size={18}
                  className="rt-row-icon shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {ws.name}
                  </span>
                  <span className="rt-text-muted block truncate text-xs">
                    {parentDir(ws.path)}
                  </span>
                </span>
                {!ws.exists && (
                  <span className="rt-badge shrink-0 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                    Missing
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LoadingRows() {
  return (
    <ul className="flex flex-col gap-0.5" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
          <span className="rt-skeleton h-4 w-4 animate-pulse rounded" />
          <span className="flex-1">
            <span className="rt-skeleton block h-3 w-32 animate-pulse rounded" />
            <span className="rt-skeleton mt-1.5 block h-2.5 w-48 animate-pulse rounded opacity-60" />
          </span>
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <div className="rt-empty flex flex-col items-center gap-2 px-4 py-8 text-center">
      <Icon name="folder" size={22} className="rt-text-faint" />
      <p className="rt-text-muted text-sm">No recent workspaces found</p>
      <p className="rt-text-faint max-w-xs text-xs">
        Projects you open in VSCode will appear here automatically.
      </p>
    </div>
  );
}

export default RecentWorkspacesPanel;
