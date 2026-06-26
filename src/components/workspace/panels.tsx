import { memo, useEffect, useRef, useState, type ReactNode } from "react";

import Icon from "../Icon";
import { highlightCode } from "../../lib/highlight";
import { useEditorStore } from "../../store/editor";
import { getClaudeTokenUsage, setClaudeTheme, type ClaudeTokenUsage } from "../../lib/fs";
import { claudeThemeForEngine } from "../../lib/theme";
import { useTheme } from "../../theme/ThemeProvider";
import type { PanelKind } from "../../lib/workspaceLayout";
import DiffViewer from "./DiffViewer";
import FileExplorerPanel from "./FileExplorerPanel";
import GitDiffPanel from "./GitDiffPanel";
import LivePreviewPanel from "./LivePreviewPanel";
import LocalhostPanel from "./LocalhostPanel";
import { SplitTerminalPanel } from "./SplitTerminalPanel";
import TerminalViewport from "./TerminalViewport";

/** Context handed to a panel renderer. */
export interface PanelRenderContext {
  /** Working directory of the active workspace (null = blank terminal). */
  cwd: string | null;
}

/* -------------------------------------------------------------------------- */
/* Terminal                                                                   */
/* -------------------------------------------------------------------------- */

// Terminal panel is now split-capable — see SplitTerminalPanel.tsx
const TerminalPanel = memo(function TerminalPanel({ cwd }: { cwd: string | null }) {
  return <SplitTerminalPanel cwd={cwd} />;
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
  const revealLine = useEditorStore((s) => s.revealLine);
  const clearReveal = useEditorStore((s) => s.clearReveal);

  const fileName = selectedPath ? selectedPath.split("/").pop() : null;
  const canEdit = !!selectedPath && !loading && !error;

  // Scroll to a target line once content has rendered (set by content search).
  // The read-only <pre> uses `whitespace-pre` (no wrapping), so one source line
  // maps to exactly one rendered line and a line-height offset lands precisely.
  const preRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (revealLine === null || content === null || diffMode || isEditing) return;
    const pre = preRef.current;
    if (!pre) return;
    const lineHeight = parseFloat(getComputedStyle(pre).lineHeight) || 19.5;
    // Leave a few lines of lead-in context above the match.
    pre.scrollTop = Math.max(0, (revealLine - 4) * lineHeight);
    clearReveal();
  }, [revealLine, content, diffMode, isEditing, clearReveal]);

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
            <pre ref={preRef} className="rt-code h-full w-full overflow-auto p-3 font-mono text-[12px] leading-relaxed whitespace-pre">
              {highlightCode(content, fileName ?? "")}
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

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

const ClaudeCodePanel = memo(function ClaudeCodePanel({
  cwd,
}: {
  cwd: string | null;
}) {
  const [usage, setUsage] = useState<ClaudeTokenUsage | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Theme-restart prompt. Claude Code reads its UI theme at launch, so a running
  // session keeps the engine it spawned under. When the engine changes such that
  // the matching Claude theme differs (light ↔ dark — same-brightness switches
  // map to the same `*-ansi` variant and need no restart), we surface a prompt
  // and let the user decide *when* to respawn rather than dropping their session.
  const { theme } = useTheme();
  const targetClaudeTheme = claudeThemeForEngine(theme);
  // Remount key for the terminal viewport: bumping it tears down the PTY and
  // relaunches `claude`, which then re-reads the freshly synced config.
  const [restartNonce, setRestartNonce] = useState(0);
  // The Claude theme the live session launched under (initialised to the theme
  // at first mount, since that's what the spawning `claude` will pick up).
  const [launchedClaudeTheme, setLaunchedClaudeTheme] = useState(targetClaudeTheme);
  // Target the user has explicitly deferred, so "Later" stops the nag until the
  // engine moves to a different brightness again.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  const themeMismatch = launchedClaudeTheme !== targetClaudeTheme;
  const showRestartPrompt = themeMismatch && dismissedFor !== targetClaudeTheme;

  const handleRestart = async () => {
    // Make sure the config reflects the current engine before we relaunch, so
    // there's no race with the ThemeProvider's own async sync.
    await setClaudeTheme(targetClaudeTheme).catch(() => {});
    setLaunchedClaudeTheme(targetClaudeTheme);
    setDismissedFor(null);
    setRestartNonce((n) => n + 1);
  };

  useEffect(() => {
    if (!cwd) return;

    const load = () =>
      getClaudeTokenUsage(cwd)
        .then((u) => setUsage(u))
        .catch(() => {});

    load();
    const id = window.setInterval(load, 30_000);
    return () => window.clearInterval(id);
  }, [cwd]);

  const hasData = usage && (usage.outputTokens > 0 || usage.sessionCount > 0);

  return (
    <div className="rt-terminal-surface flex h-full w-full flex-col">
      {/* Theme-restart prompt */}
      {showRestartPrompt && (
        <div className="rt-divider-b flex shrink-0 items-center gap-2 px-2.5 py-1.5">
          <Icon name="claudeLogo" size={12} className="rt-accent-text shrink-0" />
          <span className="rt-text-muted flex-1 text-[10px]">
            Theme changed — restart Claude Code to match{" "}
            <span className="rt-text">{theme.label}</span>?
          </span>
          <button
            type="button"
            onClick={handleRestart}
            className="rt-accent-text shrink-0 text-[10px] font-medium hover:underline"
          >
            Restart now
          </button>
          <button
            type="button"
            onClick={() => setDismissedFor(targetClaudeTheme)}
            className="rt-text-faint shrink-0 text-[10px] hover:underline"
          >
            Later
          </button>
        </div>
      )}

      {/* Stats strip */}
      {cwd && (
        <div className="rt-divider-b shrink-0">
          {hasData ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
              title={expanded ? "Hide breakdown" : "Show token breakdown"}
            >
              <Icon name="claudeLogo" size={12} className="rt-text-muted shrink-0" />
              <span className="rt-text-muted flex-1 text-[10px]">
                <span className="font-mono">{formatTokens(usage!.outputTokens)}</span>
                <span className="rt-text-faint"> output · </span>
                <span className="font-mono">{usage!.sessionCount}</span>
                <span className="rt-text-faint"> {usage!.sessionCount === 1 ? "session" : "sessions"}</span>
              </span>
              <Icon
                name={expanded ? "chevronDown" : "chevronRight"}
                size={10}
                className="rt-text-faint shrink-0"
              />
            </button>
          ) : (
            <div className="flex items-center gap-2 px-2.5 py-1.5">
              <Icon name="claudeLogo" size={12} className="rt-text-faint shrink-0" />
              <span className="rt-text-faint text-[10px]">No usage data yet for this project</span>
            </div>
          )}

          {/* Expanded breakdown */}
          {expanded && hasData && (
            <div className="border-t border-[var(--rt-border)] px-2.5 pb-2 pt-1.5">
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                {[
                  ["Input",       usage!.inputTokens],
                  ["Output",      usage!.outputTokens],
                  ["Cache read",  usage!.cacheReadTokens],
                  ["Cache write", usage!.cacheCreationTokens],
                ].map(([label, val]) => (
                  <div key={label as string} className="flex items-baseline justify-between gap-1">
                    <span className="rt-text-faint text-[9px] uppercase tracking-wide">{label}</span>
                    <span className="rt-text-muted font-mono text-[10px]">{formatTokens(val as number)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Terminal — `restartNonce` in the key forces a full remount (PTY
          teardown + a fresh `claude` launch) when the user opts to restart. */}
      <div className="min-h-0 flex-1 p-2">
        <TerminalViewport
          key={restartNonce}
          cwd={cwd}
          className="h-full w-full"
          initialCommand="claude"
          registerWithBus={false}
        />
      </div>
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
  gitDiff: ({ cwd }) => <GitDiffPanel cwd={cwd} />,
};
