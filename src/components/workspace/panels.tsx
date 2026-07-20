import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import Icon from "../Icon";
import { highlightCode } from "../../lib/highlight";
import { renderMarkdown } from "../../lib/markdown";
import { useEditorStore } from "../../store/editor";
import { getClaudeTokenUsage, setClaudeTheme, type ClaudeTokenUsage } from "../../lib/fs";
import { claudeThemeForEngine } from "../../lib/theme";
import { useTheme } from "../../theme/ThemeProvider";
import type { PanelKind } from "../../lib/workspaceLayout";
import DiffViewer from "./DiffViewer";
import FileExplorerPanel from "./FileExplorerPanel";
import GitDiffPanel from "./GitDiffPanel";
import TasksPanel from "./TasksPanel";
import LivePreviewPanel from "./LivePreviewPanel";
import LocalhostPanel from "./LocalhostPanel";
import { SplitTerminalPanel } from "./SplitTerminalPanel";
import TerminalViewport, { type TerminalControls } from "./TerminalViewport";
import { useWorkspacesStore } from "../../store/workspaces";
import { claudeBus } from "../../lib/claudeBus";

/** Context handed to a panel renderer. */
export interface PanelRenderContext {
  /** Working directory of the active workspace (null = blank terminal). */
  cwd: string | null;
  /** The tab this panel is rendered in. */
  workspaceId: string;
  /** Whether this tab is the foreground one. */
  active: boolean;
}

/* -------------------------------------------------------------------------- */
/* Terminal                                                                   */
/* -------------------------------------------------------------------------- */

// Terminal panel is now split-capable — see SplitTerminalPanel.tsx. Popping a
// pane out adds a fresh terminal panel to this tab's grid; the split's own
// close logic then hands the vacated space back to the remaining pane.
const TerminalPanel = memo(function TerminalPanel({
  cwd,
  workspaceId,
  active,
}: {
  cwd: string | null;
  workspaceId: string;
  active: boolean;
}) {
  return (
    <SplitTerminalPanel
      cwd={cwd}
      active={active}
      workspaceId={workspaceId}
      onPopOut={() => useWorkspacesStore.getState().addTerminalPanel(workspaceId)}
    />
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
  const revealLine = useEditorStore((s) => s.revealLine);
  const clearReveal = useEditorStore((s) => s.clearReveal);

  const fileName = selectedPath ? selectedPath.split("/").pop() : null;
  const canEdit = !!selectedPath && !loading && !error;
  const isMarkdown = /\.(md|markdown|mdx)$/i.test(selectedPath ?? "");
  // Markdown files default to the rendered preview; toggle to see source.
  const [mdPreview, setMdPreview] = useState(true);
  const showMarkdown = isMarkdown && mdPreview && !isEditing && !diffMode;

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

  // ── Edit mode: syntax-highlighted overlay + find/replace ──────────────────
  // The textarea's text is transparent (see `.rt-code-editor`); the highlighted
  // <pre> behind it provides the colour. They share font metrics + padding and
  // scroll in lockstep so glyphs line up exactly.
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editPreRef = useRef<HTMLPreElement | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);

  const syncOverlayScroll = useCallback(() => {
    const ta = editTextareaRef.current;
    if (ta && editPreRef.current) {
      editPreRef.current.scrollTop = ta.scrollTop;
      editPreRef.current.scrollLeft = ta.scrollLeft;
    }
  }, []);

  // Case-insensitive literal match offsets within the current draft.
  const matches = useMemo(() => {
    if (!isEditing || !findQuery) return [];
    const hay = (editDraft ?? "").toLowerCase();
    const needle = findQuery.toLowerCase();
    const out: number[] = [];
    for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
      out.push(i);
    }
    return out;
  }, [isEditing, findQuery, editDraft]);

  // Keep the active index in range as matches change (typing, replacing).
  useEffect(() => {
    if (activeMatch !== 0 && activeMatch >= matches.length) setActiveMatch(0);
  }, [matches.length, activeMatch]);

  // Reset the find UI whenever we leave edit mode or switch files.
  useEffect(() => {
    if (!isEditing) {
      setFindOpen(false);
      setFindQuery("");
      setReplaceQuery("");
      setActiveMatch(0);
    }
  }, [isEditing, selectedPath]);

  const selectMatch = useCallback(
    (idx: number) => {
      const ta = editTextareaRef.current;
      if (!ta || matches.length === 0) return;
      const i = ((idx % matches.length) + matches.length) % matches.length;
      const start = matches[i];
      ta.focus();
      ta.setSelectionRange(start, start + findQuery.length);
      requestAnimationFrame(syncOverlayScroll);
      setActiveMatch(i);
    },
    [matches, findQuery, syncOverlayScroll],
  );

  const replaceCurrent = useCallback(() => {
    if (matches.length === 0) return;
    const i = ((activeMatch % matches.length) + matches.length) % matches.length;
    const start = matches[i];
    const draft = editDraft ?? "";
    setDraft(draft.slice(0, start) + replaceQuery + draft.slice(start + findQuery.length));
  }, [matches, activeMatch, editDraft, findQuery, replaceQuery, setDraft]);

  const replaceAll = useCallback(() => {
    if (!findQuery) return;
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    setDraft((editDraft ?? "").replace(new RegExp(escaped, "gi"), replaceQuery));
  }, [findQuery, replaceQuery, editDraft, setDraft]);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    editTextareaRef.current?.focus();
  }, []);

  const onEditorKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      setFindOpen(true);
    }
  }, []);

  return (
    <div className="rt-subsurface flex h-full w-full flex-col">
      {/* Header bar */}
      <div className="rt-divider-b flex shrink-0 items-center gap-1.5 px-2.5 py-1.5">
        <Icon name="code" size={13} className="rt-accent-text shrink-0" />
        <span className="rt-text-muted min-w-0 flex-1 truncate text-xs font-medium">
          {fileName ?? "No file open"}
        </span>

        {/* Markdown preview / source toggle */}
        {canEdit && isMarkdown && !isEditing && !diffMode && (
          <button
            type="button"
            onClick={() => setMdPreview((v) => !v)}
            title={mdPreview ? "View Markdown source" : "Preview Markdown"}
            className={`rt-btn-outline flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium ${mdPreview ? "rt-btn-active" : ""}`}
          >
            <Icon name="preview" size={11} />
            {mdPreview ? "Preview" : "Source"}
          </button>
        )}

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
              onClick={() => setFindOpen((v) => !v)}
              title="Find & replace (⌘F)"
              className={`rt-btn flex h-6 w-6 shrink-0 items-center justify-center ${findOpen ? "rt-btn-active" : ""}`}
            >
              <Icon name="search" size={12} aria-label="Find and replace" />
            </button>
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
        /* ── Edit mode: find/replace bar + syntax-highlighted overlay ── */
        <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onEditorKeyDown}>
          {findOpen && (
            <div className="rt-divider-b flex shrink-0 flex-wrap items-center gap-1.5 px-2.5 py-1.5">
              <input
                autoFocus
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    selectMatch(activeMatch + (e.shiftKey ? -1 : 1));
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    closeFind();
                  }
                }}
                placeholder="Find"
                spellCheck={false}
                className="rt-input w-36 px-2 py-1 text-[12px]"
              />
              <input
                value={replaceQuery}
                onChange={(e) => setReplaceQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    closeFind();
                  }
                }}
                placeholder="Replace"
                spellCheck={false}
                className="rt-input w-36 px-2 py-1 text-[12px]"
              />
              <span className="rt-text-faint min-w-[3rem] text-center text-[11px] tabular-nums">
                {matches.length ? `${activeMatch + 1}/${matches.length}` : findQuery ? "0/0" : ""}
              </span>
              <button
                type="button"
                onClick={() => selectMatch(activeMatch - 1)}
                disabled={!matches.length}
                title="Previous match (⇧↵)"
                className="rt-btn flex h-6 w-6 items-center justify-center disabled:opacity-40"
              >
                <Icon name="chevronDown" size={12} className="rotate-180" aria-label="Previous match" />
              </button>
              <button
                type="button"
                onClick={() => selectMatch(activeMatch + 1)}
                disabled={!matches.length}
                title="Next match (↵)"
                className="rt-btn flex h-6 w-6 items-center justify-center disabled:opacity-40"
              >
                <Icon name="chevronDown" size={12} aria-label="Next match" />
              </button>
              <button
                type="button"
                onClick={replaceCurrent}
                disabled={!matches.length}
                title="Replace this match"
                className="rt-btn-outline px-2 py-0.5 text-[11px] font-medium disabled:opacity-40"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={replaceAll}
                disabled={!matches.length}
                title="Replace all matches"
                className="rt-btn-outline px-2 py-0.5 text-[11px] font-medium disabled:opacity-40"
              >
                All
              </button>
              <button
                type="button"
                onClick={closeFind}
                title="Close (Esc)"
                className="rt-btn ml-auto flex h-6 w-6 items-center justify-center"
              >
                <Icon name="close" size={11} aria-label="Close find" />
              </button>
            </div>
          )}
          <div className="relative min-h-0 flex-1 overflow-hidden ring-1 ring-inset ring-[var(--rt-accent)]">
            <pre
              ref={editPreRef}
              aria-hidden
              className="rt-code pointer-events-none absolute inset-0 m-0 overflow-auto p-3 font-mono text-[12px] leading-relaxed whitespace-pre"
            >
              {highlightCode(editDraft ?? "", fileName ?? "")}
              {"\n"}
            </pre>
            <textarea
              ref={editTextareaRef}
              value={editDraft ?? ""}
              onChange={(e) => setDraft(e.target.value)}
              onScroll={syncOverlayScroll}
              spellCheck={false}
              wrap="off"
              className="rt-code-editor absolute inset-0 resize-none overflow-auto whitespace-pre bg-transparent p-3 font-mono text-[12px] leading-relaxed outline-none"
              style={{ colorScheme: "inherit" }}
            />
          </div>
        </div>
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
          ) : showMarkdown ? (
            <div className="h-full w-full overflow-auto px-4 py-3">{renderMarkdown(content ?? "")}</div>
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

/**
 * A compact context-window donut. `r = 15.9155` makes the ring's circumference
 * exactly 100, so `strokeDasharray` can take the fill percent directly. Renders
 * the rounded percent in the centre.
 */
function ContextDonut({
  pct,
  color,
  size = 22,
}: {
  pct: number;
  color: string;
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" className="shrink-0">
      <circle
        cx="18"
        cy="18"
        r="15.9155"
        fill="none"
        stroke="var(--rt-border)"
        strokeWidth="4"
      />
      <circle
        cx="18"
        cy="18"
        r="15.9155"
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${Math.max(pct * 100, 0.5)} 100`}
        transform="rotate(-90 18 18)"
        style={{ transition: "stroke-dasharray 500ms, stroke 300ms" }}
      />
      <text
        x="18"
        y="18"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-[var(--rt-text-muted)] font-mono"
        style={{ fontSize: "11px" }}
      >
        {Math.round(pct * 100)}
      </text>
    </svg>
  );
}

const ClaudeCodePanel = memo(function ClaudeCodePanel({
  cwd,
  workspaceId,
}: {
  cwd: string | null;
  workspaceId: string;
}) {
  // Expose this Claude session's paste/focus to the workspace's Terminal panel
  // (via claudeBus) so "send last output to Claude" can reach it. The controls
  // arrive once the PTY connects; a ref keeps the latest across restarts.
  const controlsRef = useRef<TerminalControls | null>(null);
  useEffect(() => {
    claudeBus.set(workspaceId, {
      // Bracketed paste: Claude Code inserts it into the prompt as pasted text
      // (multi-line safe) without submitting, so the user can add a question.
      paste: (text) => controlsRef.current?.write(`\x1b[200~${text}\x1b[201~`),
      focus: () => controlsRef.current?.focus(),
      submit: () => controlsRef.current?.write("\r"),
    });
    return () => claudeBus.clear(workspaceId);
  }, [workspaceId]);
  const [usage, setUsage] = useState<ClaudeTokenUsage | null>(null);
  const [expanded, setExpanded] = useState(false);
  // Context gauge starts collapsed to a bare donut; click to reveal the bar.
  const [ctxOpen, setCtxOpen] = useState(false);

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

  // Context window fill for the live session — the headline gauge.
  const ctxPct =
    usage && usage.contextWindow > 0
      ? Math.min(1, usage.contextTokens / usage.contextWindow)
      : 0;
  const showContext = !!usage && usage.contextTokens > 0;
  // Warm the bar as the window fills so compaction is never a surprise.
  const ctxColor =
    ctxPct >= 0.85 ? "#ef4444" : ctxPct >= 0.6 ? "#f59e0b" : "var(--rt-accent)";

  // Close the floating context popover on any click outside its badge.
  const ctxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ctxOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!ctxRef.current?.contains(e.target as Node)) setCtxOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ctxOpen]);

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
      <div className="relative min-h-0 flex-1 p-2">
        <TerminalViewport
          key={restartNonce}
          cwd={cwd}
          className="h-full w-full"
          initialCommand="claude"
          registerWithBus={false}
          registerControls={(c) => { controlsRef.current = c; }}
        />

        {/* Floating context-window donut — overlays the terminal's top-right
            corner (zero layout cost). Click for the full breakdown popover. */}
        {showContext && (
          <div ref={ctxRef} className="absolute right-3 top-3 z-40">
            <button
              type="button"
              onClick={() => setCtxOpen((v) => !v)}
              aria-label={`Context window ${Math.round(ctxPct * 100)}% used`}
              title="Context window"
              className="rt-menu flex items-center justify-center rounded-full p-0.5 shadow-sm transition-opacity hover:opacity-100 opacity-70"
            >
              <ContextDonut pct={ctxPct} color={ctxColor} size={26} />
            </button>

            {ctxOpen && (
              <div className="rt-menu absolute right-0 top-full z-50 mt-1.5 w-52 p-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="rt-text-muted text-[10px] font-medium uppercase tracking-wide">
                    Context window
                  </span>
                  <span className="rt-text font-mono text-[11px] tabular-nums">
                    {Math.round(ctxPct * 100)}%
                  </span>
                </div>
                <div
                  className="relative mb-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--rt-border)]"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={usage!.contextWindow}
                  aria-valuenow={usage!.contextTokens}
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
                    style={{ width: `${Math.max(2, ctxPct * 100)}%`, background: ctxColor }}
                  />
                </div>
                <div className="rt-text-faint font-mono text-[10px] tabular-nums">
                  {formatTokens(usage!.contextTokens)} / {formatTokens(usage!.contextWindow)} tokens
                </div>
                {usage!.model && (
                  <div className="rt-text-faint mt-0.5 truncate text-[10px]">
                    {usage!.model}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
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
  terminal: ({ cwd, workspaceId, active }) => (
    <TerminalPanel cwd={cwd} workspaceId={workspaceId} active={active} />
  ),
  fileExplorer: ({ cwd }) => <FileExplorerPanel cwd={cwd} />,
  codeView: () => <CodeViewPanel />,
  localhost: () => <LocalhostPanel />,
  claudeCode: ({ cwd, workspaceId }) => <ClaudeCodePanel cwd={cwd} workspaceId={workspaceId} />,
  livePreview: () => <LivePreviewPanel />,
  gitDiff: ({ cwd }) => <GitDiffPanel cwd={cwd} />,
  tasks: ({ cwd }) => <TasksPanel cwd={cwd} />,
};
