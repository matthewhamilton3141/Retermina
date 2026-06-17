import { memo, type ReactNode } from "react";

import Icon from "../Icon";
import { prettyPath } from "../../lib/format";
import type { PanelKind } from "../../lib/workspaceLayout";
import LocalhostPanel from "./LocalhostPanel";
import TerminalViewport from "./TerminalViewport";

/** Context handed to a panel renderer. */
export interface PanelRenderContext {
  /** Working directory of the active workspace (null = blank terminal). */
  cwd: string | null;
}

/* -------------------------------------------------------------------------- */
/* Terminal                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Hosts the live terminal. Memoized so the frequent re-renders that happen
 * while dragging/resizing other panels never reach the xterm subtree (which
 * would otherwise risk tearing down its PTY binding).
 */
const TerminalPanel = memo(function TerminalPanel({
  cwd,
}: {
  cwd: string | null;
}) {
  return (
    <div className="rt-terminal-surface h-full w-full p-2">
      <TerminalViewport cwd={cwd} className="h-full w-full" />
    </div>
  );
});

/* -------------------------------------------------------------------------- */
/* File Explorer (placeholder until the editor integration lands)             */
/* -------------------------------------------------------------------------- */

function FileExplorerPanel({ cwd }: { cwd: string | null }) {
  const root = cwd ? prettyPath(cwd) : "No folder open";
  return (
    <div className="rt-subsurface flex h-full w-full flex-col">
      <div className="rt-divider-b rt-text-muted flex items-center gap-1.5 px-2.5 py-1.5 text-xs">
        <Icon name="folder" size={13} className="rt-accent-text shrink-0" />
        <span className="truncate" title={cwd ?? undefined}>
          {root}
        </span>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 text-center">
        <p className="rt-text-muted text-xs leading-relaxed">
          The file tree arrives with the editor integration. For now, use the
          terminal to navigate the project.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                   */
/* -------------------------------------------------------------------------- */

/** Maps each panel kind to the component that renders its body. */
export const PANEL_RENDERERS: Record<
  PanelKind,
  (ctx: PanelRenderContext) => ReactNode
> = {
  terminal: ({ cwd }) => <TerminalPanel cwd={cwd} />,
  fileExplorer: ({ cwd }) => <FileExplorerPanel cwd={cwd} />,
  localhost: () => <LocalhostPanel />,
};
