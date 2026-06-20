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
/* Code View (placeholder until the editor integration lands)                 */
/* -------------------------------------------------------------------------- */

function CodeViewPanel({ cwd }: { cwd: string | null }) {
  return (
    <div className="rt-subsurface flex h-full w-full flex-col">
      <div className="rt-divider-b rt-text-muted flex items-center gap-1.5 px-2.5 py-1.5 text-xs">
        <Icon name="code" size={13} className="rt-accent-text shrink-0" />
        <span className="truncate">Code</span>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 text-center">
        <p className="rt-text-muted text-xs leading-relaxed">
          {cwd
            ? "A read-only code viewer for this workspace arrives with the editor integration. For now, use the terminal to view files."
            : "Open a folder to view its files here once the editor integration lands."}
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Claude Code                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Hosts a dedicated terminal session for the `claude` CLI, auto-started the
 * moment its PTY connects. Memoized for the same reason as TerminalPanel: it
 * owns a live PTY session that must survive unrelated re-renders (drag,
 * resize, theme changes) without tearing down.
 *
 * `registerWithBus={false}` is the important bit — without it, this panel
 * would compete with the regular Terminal panel for Iris's single
 * active-terminal slot, and a command typed into Iris could end up routed
 * into the `claude` session instead of the user's actual shell depending on
 * which panel happened to connect or focus most recently. Iris should always
 * reach the user's shell; this pane is a separate, self-contained session.
 */
const ClaudeCodePanel = memo(function ClaudeCodePanel({
  cwd,
}: {
  cwd: string | null;
}) {
  return (
    <div className="rt-terminal-surface h-full w-full p-2">
      <TerminalViewport
        cwd={cwd}
        className="h-full w-full"
        initialCommand="claude"
        registerWithBus={false}
      />
    </div>
  );
});

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
  codeView: ({ cwd }) => <CodeViewPanel cwd={cwd} />,
  localhost: () => <LocalhostPanel />,
  claudeCode: ({ cwd }) => <ClaudeCodePanel cwd={cwd} />,
};
