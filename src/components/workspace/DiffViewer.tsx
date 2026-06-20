import { useEffect, useRef } from "react";
import { useEditorStore } from "../../store/editor";
import { collapseDiff, computeLineDiff, hasChanges } from "../../lib/diff";
import Icon from "../Icon";

const POLL_MS = 1500;

interface DiffViewerProps {
  /**
   * When true, renders only the small "Diff" toggle button that activates
   * diff mode (used in the Code panel's header row).
   * When false/absent, renders the full diff body (used as the panel body).
   */
  headerOnly?: boolean;
}

/**
 * Live diff viewer for the Code panel.
 *
 * headerOnly=true  → a compact button that enables diff mode
 * headerOnly=false → the full scrollable diff body with a toolbar
 *
 * When diff mode is active, polls the open file every 1.5 s and renders a
 * git-diff-style view: green for additions, red for deletions, grey for
 * unchanged context. Long unchanged runs are collapsed to keep it readable.
 *
 * The component owns the poll interval so nothing leaks into the store.
 */
export function DiffViewer({ headerOnly = false }: DiffViewerProps) {
  const selectedPath = useEditorStore((s) => s.selectedPath);
  const content = useEditorStore((s) => s.content);
  const diffMode = useEditorStore((s) => s.diffMode);
  const baseline = useEditorStore((s) => s.baseline);
  const refreshContent = useEditorStore((s) => s.refreshContent);
  const enableDiff = useEditorStore((s) => s.enableDiff);
  const disableDiff = useEditorStore((s) => s.disableDiff);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll loop — only runs when diff mode is active.
  useEffect(() => {
    if (!diffMode || !selectedPath) {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      refreshContent();
    }, POLL_MS);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [diffMode, selectedPath, refreshContent]);

  if (!selectedPath || content === null) return null;

  // ── Header-only mode: just the enable button ──────────────────────────────
  if (headerOnly) {
    return (
      <button
        type="button"
        onClick={enableDiff}
        title="Track live changes against this snapshot"
        className="rt-btn-outline flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium"
      >
        <Icon name="sync" size={11} />
        Diff
      </button>
    );
  }

  // ── Full diff body ────────────────────────────────────────────────────────
  const diff = computeLineDiff(baseline ?? "", content);
  const collapsed = collapseDiff(diff, 3);
  const changed = hasChanges(diff);

  const addedCount = diff.filter((l) => l.type === "added").length;
  const removedCount = diff.filter((l) => l.type === "removed").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* diff toolbar */}
      <div className="rt-divider-b flex shrink-0 items-center gap-2 px-2.5 py-1">
        <span className="text-[11px]">
          {changed ? (
            <>
              <span className="text-emerald-600 font-medium">+{addedCount}</span>
              <span className="rt-text-faint mx-1">·</span>
              <span className="text-red-500 font-medium">−{removedCount}</span>
            </>
          ) : (
            <span className="rt-text-muted">no changes</span>
          )}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={enableDiff}
          title="Re-snapshot current content as new baseline"
          className="rt-btn px-1.5 py-0.5 text-[11px]"
        >
          Reset baseline
        </button>
        <button
          type="button"
          onClick={disableDiff}
          title="Exit diff mode"
          className="rt-btn flex items-center gap-1 px-1.5 py-0.5 text-[11px]"
        >
          <Icon name="close" size={11} />
          Exit diff
        </button>
      </div>

      {/* diff body */}
      <div className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-5">
        {!changed ? (
          <div className="flex h-full items-center justify-center px-4 text-center">
            <p className="rt-text-muted text-xs">
              File unchanged since baseline was captured.
            </p>
          </div>
        ) : (
          collapsed.map((line, idx) => {
            if (line.text === "…") {
              return (
                <div
                  key={idx}
                  className="rt-text-faint select-none px-3 py-px text-center text-[10px]"
                >
                  ···
                </div>
              );
            }

            const isAdded = line.type === "added";
            const isRemoved = line.type === "removed";

            const rowBg = isAdded
              ? "bg-emerald-500/10"
              : isRemoved
              ? "bg-red-500/10"
              : "";
            const gutterCls = isAdded
              ? "text-emerald-600"
              : isRemoved
              ? "text-red-500"
              : "rt-text-faint";
            const textCls = isAdded
              ? "text-emerald-800 dark:text-emerald-300"
              : isRemoved
              ? "text-red-800 dark:text-red-300"
              : "";
            const sigil = isAdded ? "+" : isRemoved ? "−" : " ";
            const lineNum = isAdded ? line.newNum : line.oldNum;

            return (
              <div
                key={idx}
                className={`flex items-start whitespace-pre ${rowBg}`}
              >
                <span
                  className={`w-10 shrink-0 select-none pr-2 text-right text-[10px] leading-5 ${gutterCls}`}
                >
                  {lineNum ?? ""}
                </span>
                <span
                  className={`w-4 shrink-0 select-none text-center font-bold leading-5 ${gutterCls}`}
                >
                  {sigil}
                </span>
                <span className={textCls}>{line.text}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default DiffViewer;
