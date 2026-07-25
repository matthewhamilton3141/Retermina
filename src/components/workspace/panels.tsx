import { memo, type ReactNode } from "react";

import type { PanelKind } from "../../lib/workspaceLayout";
import { useWorkspacesStore } from "../../store/workspaces";
import ClaudeCodePanel from "./ClaudeCodePanel";
import CodeEditorPanel from "./CodeEditorPanel";
import FileExplorerPanel from "./FileExplorerPanel";
import GitDiffPanel from "./GitDiffPanel";
import LivePreviewPanel from "./LivePreviewPanel";
import LocalhostPanel from "./LocalhostPanel";
import { SplitTerminalPanel } from "./SplitTerminalPanel";
import TasksPanel from "./TasksPanel";

/** Context handed to a panel renderer. */
export interface PanelRenderContext {
  /** Working directory of the active workspace (null = blank terminal). */
  cwd: string | null;
  /** The tab this panel is rendered in. */
  workspaceId: string;
  /** Whether this tab is the foreground one. */
  active: boolean;
}

const TerminalPanel = memo(function TerminalPanel({
  cwd,
  workspaceId,
  active,
}: PanelRenderContext) {
  return (
    <SplitTerminalPanel
      cwd={cwd}
      active={active}
      workspaceId={workspaceId}
      onPopOut={() => useWorkspacesStore.getState().addTerminalPanel(workspaceId)}
    />
  );
});

/**
 * Maps every serializable panel kind to its live component. `fileExplorer`
 * remains readable for legacy layouts, while all current UI routes Explorer
 * requests to the integrated `codeView` workbench.
 */
export const PANEL_RENDERERS: Record<
  PanelKind,
  (context: PanelRenderContext) => ReactNode
> = {
  terminal: (context) => <TerminalPanel {...context} />,
  fileExplorer: ({ cwd }) => <FileExplorerPanel cwd={cwd} />,
  codeView: ({ cwd }) => <CodeEditorPanel cwd={cwd} />,
  localhost: () => <LocalhostPanel />,
  claudeCode: ({ cwd, workspaceId, active }) => (
    <ClaudeCodePanel cwd={cwd} workspaceId={workspaceId} active={active} />
  ),
  livePreview: () => <LivePreviewPanel />,
  gitDiff: ({ cwd }) => <GitDiffPanel cwd={cwd} />,
  tasks: ({ cwd }) => <TasksPanel cwd={cwd} />,
};
