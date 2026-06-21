import { memo, type ReactNode } from "react";

import Icon from "../Icon";
import { useEditorStore } from "../../store/editor";
import type { PanelKind } from "../../lib/workspaceLayout";
import DiffViewer from "./DiffViewer";
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
  const diffMode = useEditorStore((s) => s.diffMode);
  const isEditing = useEditorStore((s) => s.isEditing);
  const editDraft = useEditorStore((s) => s.editDraft);
  const saving = useEditorStore((s) => s.saving);
  const saveError = useEditorStore((s) => s.saveError);
  const startEditing = useEditorStore((s) => s.startEditing);
  const setDraft = useEditorStore((s) => s.setDraft);
  const cancelEditing = useEditorStore((s) => s.cancelEditing);
  const saveEdits = useEditorStore((s) => s.saveEdits);
  const close = useEditorStore((s) => s.close);

  const fileName = selectedPath ? selectedPath.split("/").pop() : null;
  const canEdit = !!selectedPath && !loading && !error;

  return (
    <div className="rt-subsurface flex h-full w-full flex-col">
      {/* Header bar */}
      <div className="rt-divider-b flex shrink-0 items-center gap-1.5 px-2.5 py-1.5">
        <Icon name="code" size={13} className="rt-accent-text shrink-0" />
        <span className="rt-text-muted min-w-0 flex-1 truncate text-xs font-medium">
          {fileName ?? "No file open"}
        </span>

        {/* Diff toggle — hidden while editing */}
        {canEdit && !isEditing && !diffMode && <DiffViewer headerOnly />}

        {/* Safe Edit controls */}
        {canEdit && !isEditing && (
          <button
            type="button"
            onClick={startEditing}
            title="Unlock file for editing"
            className="rt-btn-outline flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium"
          >
            <Icon name="file" size={11} />
            Edit
          </button>
        )}
        {canEdit && isEditing && (
          <>
            <button
              type="button"
              onClick={cancelEditing}
              disabled={saving}
              title="Discard changes and lock"
              className="rt-btn-outline flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium"
            >
              <Icon name="close" size={11} />
              Cancel
            </button>
            <button
              type="button"
              onClick={saveEdits}
              disabled={saving}
              title="Save and lock"
              className="rt-btn-outline flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rt-btn-active"
            >
              {saving ? (
                <Icon name="sync" size={11} className="animate-spin" />
              ) : (
                <Icon name="file" size={11} />
              )}
              {saving ? "Saving…" : "Lock"}
            </button>
          </>
        )}

        {selectedPath && !isEditing && (
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

      {/* Save error banner */}
      {saveError && (
        <div className="shrink-0 bg-red-500/10 px-3 py-1.5">
          <p className="text-[11px] text-red-500">{saveError}</p>
        </div>
      )}

      {/* Body */}
      {isEditing ? (
        /* ── Edit mode ── */
        <textarea
          value={editDraft ?? ""}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[12px] leading-relaxed outline-none ring-1 ring-inset ring-[var(--rt-accent)]"
          style={{ colorScheme: "inherit" }}
        />
      ) : diffMode && selectedPath && !loading && !error ? (
        /* ── Diff mode ── */
        <DiffViewer />
      ) : (
        /* ── Read-only mode ── */
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
      )}
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
