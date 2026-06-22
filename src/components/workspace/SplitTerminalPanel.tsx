/**
 * SplitTerminalPanel — a terminal panel that can be divided into multiple
 * independent panes, each running its own PTY session.
 *
 * Hover over the panel to reveal the split controls (top-right corner).
 * Click "H" to split side-by-side, "V" to split top/bottom. Drag the
 * divider between panes to resize. Each pane shows an × close button on
 * hover; closing a pane gives its space back to its neighbour.
 *
 * Split state is local to this component so it survives grid drags and
 * theme changes without remounting (the memo key in WorkspaceLayout
 * stays stable).
 */
import { Fragment, memo, useCallback, useRef, useState } from "react";

import Icon from "../Icon";
import TerminalViewport from "./TerminalViewport";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Pane {
  id: string;
  /** Percentage of the container (0–100). All panes sum to 100. */
  size: number;
}

type Direction = "h" | "v"; // horizontal (side-by-side) | vertical (stacked)

let _counter = 0;
const uid = () => `sp-${++_counter}`;

// ---------------------------------------------------------------------------
// Draggable divider
// ---------------------------------------------------------------------------

function PaneDivider({
  direction,
  onDrag,
}: {
  direction: Direction;
  onDrag: (incrementalDeltaPx: number) => void;
}) {
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      let last = direction === "h" ? e.clientX : e.clientY;

      const onMove = (ev: MouseEvent) => {
        const cur = direction === "h" ? ev.clientX : ev.clientY;
        onDrag(cur - last);
        last = cur;
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [direction, onDrag],
  );

  return (
    <div
      onMouseDown={onMouseDown}
      className={`group/div shrink-0 transition-colors hover:bg-[var(--rt-accent)] ${
        direction === "h"
          ? "w-[3px] cursor-col-resize bg-[var(--rt-border)]"
          : "h-[3px] cursor-row-resize bg-[var(--rt-border)]"
      }`}
    />
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SplitTerminalPanel = memo(function SplitTerminalPanel({
  cwd,
}: {
  cwd: string | null;
}) {
  const [panes, setPanes] = useState<Pane[]>([{ id: uid(), size: 100 }]);
  const [direction, setDirection] = useState<Direction>("h");
  const containerRef = useRef<HTMLDivElement>(null);

  const multi = panes.length > 1;

  // ── Split ──────────────────────────────────────────────────────────────────

  const split = useCallback((dir: Direction) => {
    setDirection(dir);
    setPanes((prev) => {
      // Split the last pane in half.
      const last = prev[prev.length - 1];
      const half = last.size / 2;
      return [
        ...prev.slice(0, -1),
        { ...last, size: half },
        { id: uid(), size: half },
      ];
    });
  }, []);

  // ── Close pane ─────────────────────────────────────────────────────────────

  const closePane = useCallback((id: string) => {
    setPanes((prev) => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex((p) => p.id === id);
      const removed = prev[idx];
      const next = prev.filter((p) => p.id !== id);
      // Give the closed pane's space to its neighbour.
      const neighbour = Math.min(idx, next.length - 1);
      next[neighbour] = { ...next[neighbour], size: next[neighbour].size + removed.size };
      return next;
    });
  }, []);

  // ── Divider drag ───────────────────────────────────────────────────────────

  const onDividerDrag = useCallback(
    (idx: number, deltaPixels: number) => {
      const container = containerRef.current;
      if (!container) return;
      const totalPx =
        direction === "h" ? container.clientWidth : container.clientHeight;
      const deltaPct = (deltaPixels / totalPx) * 100;

      setPanes((prev) => {
        const next = [...prev];
        const minPct = 15; // each pane must stay ≥15%
        const combined = next[idx].size + next[idx + 1].size;
        const newLeft = Math.max(
          minPct,
          Math.min(combined - minPct, next[idx].size + deltaPct),
        );
        next[idx]     = { ...next[idx],     size: newLeft };
        next[idx + 1] = { ...next[idx + 1], size: combined - newLeft };
        return next;
      });
    },
    [direction],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const flexDir = direction === "h" ? "flex-row" : "flex-col";

  return (
    <div className="rt-terminal-surface relative flex h-full w-full flex-col overflow-hidden">
      {/* ── Split toolbar — pinned to the top of the terminal panel ── */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--rt-border)] px-2 py-1">
        <span className="rt-text-faint mr-auto text-[10px] font-medium uppercase tracking-wider">
          Split
        </span>
        <button
          type="button"
          onClick={() => split("h")}
          title="Split horizontally (side-by-side)"
          className="rt-btn-outline flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium"
        >
          <Icon name="columns" size={11} />
          <span>H</span>
        </button>
        <button
          type="button"
          onClick={() => split("v")}
          title="Split vertically (stacked)"
          className="rt-btn-outline flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium"
        >
          <Icon name="rows" size={11} />
          <span>V</span>
        </button>
        {multi && (
          <button
            type="button"
            onClick={() => setPanes([{ id: uid(), size: 100 }])}
            title="Merge all panes back into one"
            className="rt-btn-outline px-1.5 py-0.5 text-[10px] font-medium"
          >
            Merge
          </button>
        )}
      </div>

      {/* ── Panes ── */}
      <div ref={containerRef} className={`flex min-h-0 flex-1 ${flexDir}`}>
        {panes.map((pane, idx) => (
          <Fragment key={pane.id}>
            <div
              className="group/pane relative min-h-0 min-w-0 p-1"
              style={{ flexBasis: `${pane.size}%`, flexShrink: 0, flexGrow: 0 }}
            >
              {/* Per-pane close button */}
              {multi && (
                <button
                  type="button"
                  onClick={() => closePane(pane.id)}
                  title="Close this pane"
                  className="rt-btn absolute right-2 top-2 z-20 flex h-5 w-5 items-center justify-center opacity-0 transition-opacity group-hover/pane:opacity-100"
                >
                  <Icon name="close" size={10} aria-label="Close pane" />
                </button>
              )}
              <TerminalViewport cwd={cwd} className="h-full w-full" />
            </div>

            {idx < panes.length - 1 && (
              <PaneDivider
                direction={direction}
                onDrag={(delta) => onDividerDrag(idx, delta)}
              />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
});

export default SplitTerminalPanel;
