import { memo, type ReactNode } from "react";

import Icon from "../Icon";
import { useEditorStore } from "../../store/editor";
import type { PanelKind } from "../../lib/workspaceLayout";
import FileExplorerPanel from "./FileExplorerPanel";
import LivePreviewPanel from "./LivePreviewPanel";
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
/* Code View                                                                  */
/* -------------------------------------------------------------------------- */

function CodeViewPanel() {
  const selectedPath = useEditorStore((s) => s.selectedPath);
  const content = useEditorStore((s) => s.content);
  const loading = useEditorStore((s) => s.loading);
  const error = useEditorStore((s) => s.error);
  const close = useEditorStore((s) => s.close);

  const fileName = selectedPath ? selectedPath.split("/").pop() : null;

  return (
    <div className="rt-subsurface flex h-full w-full flex-col">
      <div className="rt-divider-b flex shrink-0 items-center gap-1.5 px-2.5 py-1.5">
        <Icon name="code" size={13} className="rt-accent-text shrink-0" />
        <span className="rt-text-muted min-w-0 flex-1 truncate text-xs font-medium">
          {fileName ?? "No file open"}
        </span>
        {selectedPath && (
          <button
            type="button"
            onClick={close}
            title="Close file"
            className="rt-btn flex h-5 w-5 shrink-0 items-center justify-center"
          >
            <Icon name="close" size={11} aria-label="Close file" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {!selectedPath ? (
          <div className="flex h-full items-center justify-center px-4 text-center">
            <p className="rt-text-muted text-xs leading-relaxed">
              Click a file in the Explorer to open it here.
            </p>
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center gap-2">
            <Icon name="sync" size={14} className="rt-text-faint animate-spin" />
            <span className="rt-text-faint text-xs">Loading…</span>
          </div>
        ) : error ? (
          <div className="px-3 py-2">
            <p className="rt-text-muted text-[11px] leading-snug">{error}</p>
          </div>
        ) : (
          <pre className="h-full w-full overflow-auto p-3 font-mono text-[12px] leading-relaxed whitespace-pre">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Claude Code                                                                */
/* -------------------------------------------------------------------------- */

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
  codeView: () => <CodeViewPanel />,
  localhost: () => <LocalhostPanel />,
  claudeCode: ({ cwd }) => <ClaudeCodePanel cwd={cwd} />,
  livePreview: () => <LivePreviewPanel />,
};
