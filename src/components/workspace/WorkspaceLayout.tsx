import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import GridLayout, { noCompactor, type Layout, type LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import PanelFrame from "./PanelFrame";
import { PANEL_RENDERERS } from "./panels";
import { useWorkspaceStore } from "../../store/workspace";
import {
  GRID_COLS,
  GRID_MARGIN,
  GRID_ROWS,
  MIN_ROW_HEIGHT,
  PANEL_META,
} from "../../lib/workspaceLayout";

export interface WorkspaceLayoutProps {
  cwd: string | null;
}

interface ElementSize {
  width: number;
  height: number;
}

/** Ghost indicator state computed on every drag frame. */
interface SwapGhost {
  /** Grid-unit position of the swap *target* (the panel being displaced). */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * True = swap is valid and will commit on drop (accent border).
   * False = swap would violate grid bounds and will be aborted (red border).
   */
  valid: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Whether placing `item` at these coords would stay inside the 12×10 grid. */
function isInBounds(
  item: { w: number; h: number },
  x: number,
  y: number,
): boolean {
  return x >= 0 && y >= 0 && x + item.w <= GRID_COLS && y + item.h <= GRID_ROWS;
}

/**
 * Return the z-index for `panelId` during a drag gesture.
 *
 * The active panel returns 999 (floats above everything); all others return 10.
 * In practice this is expressed purely in CSS (`.react-draggable-dragging` →
 * `z-index: 999`) so we never need to touch the memoized children divs —
 * this function is kept as the authoritative source of truth for those values.
 */
export function getPanelZIndex(
  panelId: string,
  draggingId: string | null,
): number {
  return panelId === draggingId ? 999 : 10;
}

/** Track a host element's content box via ResizeObserver. */
function useElementSize() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (w: number, h: number) =>
      setSize((prev) =>
        prev.width === w && prev.height === h ? prev : { width: w, height: h },
      );
    apply(el.clientWidth, el.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) apply(Math.round(rect.width), Math.round(rect.height));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, ...size };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorkspaceLayout({ cwd }: WorkspaceLayoutProps) {
  const panels    = useWorkspaceStore((s) => s.panels);
  const grid      = useWorkspaceStore((s) => s.grid);
  const setGrid   = useWorkspaceStore((s) => s.setGrid);
  const closePanel = useWorkspaceStore((s) => s.closePanel);

  const { ref, width, height } = useElementSize();
  const mounted = width > 0 && height > 0;

  const rowHeight = useMemo(() => {
    const usable = height - (GRID_ROWS - 1) * GRID_MARGIN[1];
    return Math.max(MIN_ROW_HEIGHT, Math.floor(usable / GRID_ROWS));
  }, [height]);

  // ── Drag state (local only — never touches the children memo) ─────────────
  const preDragRef = useRef<Layout>([]);
  const [swapGhost, setSwapGhost] = useState<SwapGhost | null>(null);

  // ── Utility ───────────────────────────────────────────────────────────────

  /** Clamp a layout item to grid bounds. */
  const clamp = useCallback(
    (item: LayoutItem): LayoutItem => ({
      ...item,
      x: Math.max(0, Math.min(item.x, GRID_COLS - item.w)),
      y: Math.max(0, Math.min(item.y, GRID_ROWS - item.h)),
    }),
    [],
  );

  /**
   * Convert ghost grid coords to pixel position inside the container.
   * Derived from the same formula RGL uses internally.
   */
  const ghostPixels = useMemo(() => {
    if (!swapGhost || width === 0) return null;
    const colW = (width - (GRID_COLS - 1) * GRID_MARGIN[0]) / GRID_COLS;
    return {
      left:   swapGhost.x * (colW + GRID_MARGIN[0]),
      top:    swapGhost.y * (rowHeight + GRID_MARGIN[1]),
      width:  swapGhost.w * colW  + (swapGhost.w - 1) * GRID_MARGIN[0],
      height: swapGhost.h * rowHeight + (swapGhost.h - 1) * GRID_MARGIN[1],
      valid:  swapGhost.valid,
    };
  }, [swapGhost, width, rowHeight]);

  // ── Drag handlers ─────────────────────────────────────────────────────────

  /** Snapshot the full layout the instant a drag begins. */
  const handleDragStart = useCallback((layout: Layout) => {
    preDragRef.current = [...layout];
    setSwapGhost(null);
  }, []);

  /**
   * Every drag frame: find the swap candidate from the pre-drag snapshot,
   * validate grid bounds, and update the ghost indicator accordingly.
   * Does NOT write to the store — purely visual.
   */
  const handleDrag = useCallback(
    (
      _layout: Layout,
      _oldItem: LayoutItem | null,
      newItem: LayoutItem | null,
    ) => {
      if (!newItem || !_oldItem) { setSwapGhost(null); return; }

      const pre = preDragRef.current;
      const origin = pre.find((i) => i.i === newItem.i) ?? _oldItem;

      // Which pre-drag panel sits under the current drag position?
      const target = pre.find(
        (item) =>
          item.i !== newItem.i &&
          newItem.x < item.x + item.w &&
          newItem.x + newItem.w > item.x &&
          newItem.y < item.y + item.h &&
          newItem.y + newItem.h > item.y,
      );

      if (!target) { setSwapGhost(null); return; }

      // Validate: can the displaced panel fit at the drag origin?
      const valid = isInBounds(target, origin.x, origin.y);

      setSwapGhost({ x: target.x, y: target.y, w: target.w, h: target.h, valid });
    },
    [],
  );

  /**
   * On drop: commit a validated swap, or abort back to origin if bounds
   * would be violated. Clamps every position before writing to the store.
   */
  const handleDragStop = useCallback(
    (
      _layout: Layout,
      oldItem: LayoutItem | null,
      newItem: LayoutItem | null,
    ) => {
      setSwapGhost(null);
      if (!oldItem || !newItem) return;

      const pre = preDragRef.current;

      // Panels that the dragged item is overlapping at the drop position.
      const displaced = pre.filter(
        (item) =>
          item.i !== newItem.i &&
          newItem.x < item.x + item.w &&
          newItem.x + newItem.w > item.x &&
          newItem.y < item.y + item.h &&
          newItem.y + newItem.h > item.y,
      );

      // No collision — plain move, just clamp.
      if (displaced.length === 0) {
        setGrid(_layout.map(clamp));
        return;
      }

      // Constraint check: every displaced panel must fit at the drag origin.
      const swapValid = displaced.every((d) =>
        isInBounds(d, oldItem.x, oldItem.y),
      );

      if (!swapValid) {
        // Abort: return the dragged panel to where it started.
        setGrid(
          _layout.map((item) =>
            item.i === newItem.i
              ? clamp({ ...item, x: oldItem.x, y: oldItem.y })
              : clamp(item),
          ),
        );
        return;
      }

      // Commit: swap displaced panels to the drag origin.
      setGrid(
        _layout.map((item) => {
          const wasDisplaced = displaced.find((d) => d.i === item.i);
          return wasDisplaced
            ? clamp({ ...item, x: oldItem.x, y: oldItem.y })
            : clamp(item);
        }),
      );
    },
    [setGrid, clamp],
  );

  const handleLayoutChange = useCallback(
    (next: Layout) => setGrid(next.map(clamp)),
    [setGrid, clamp],
  );

  // ── Children (memoized — never rebuilt on drag/resize) ────────────────────
  const children = useMemo(
    () =>
      panels.map((panel) => {
        const renderer = PANEL_RENDERERS[panel.kind];
        if (!renderer) return null;
        return (
          <div key={panel.id} className="overflow-hidden">
            <PanelFrame
              icon={PANEL_META[panel.kind].icon}
              title={panel.title}
              onClose={() => closePanel(panel.id)}
            >
              {renderer({ cwd })}
            </PanelFrame>
          </div>
        );
      }),
    [panels, cwd, closePanel],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div ref={ref} className="relative h-full w-full overflow-hidden">
      {!mounted ? null : panels.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center px-6 text-center">
          <p className="rt-text-muted text-sm">
            All panels are hidden. Use the toolbar above to bring one back.
          </p>
        </div>
      ) : (
        <>
          {/* Ghost indicator — swap preview, rendered outside memoized children */}
          {ghostPixels && (
            <div
              className="pointer-events-none absolute z-50"
              style={{
                left:   ghostPixels.left,
                top:    ghostPixels.top,
                width:  ghostPixels.width,
                height: ghostPixels.height,
                borderRadius: "var(--rt-radius-lg)",
                border: `2px dashed ${
                  ghostPixels.valid ? "var(--rt-accent)" : "#ef4444"
                }`,
                backgroundColor: ghostPixels.valid
                  ? "var(--rt-accent-soft)"
                  : "rgba(239, 68, 68, 0.12)",
                transition: "none",
              }}
            />
          )}

          <GridLayout
            className="retermina-grid"
            width={width}
            layout={grid}
            onLayoutChange={handleLayoutChange}
            onDragStart={handleDragStart}
            onDrag={handleDrag}
            onDragStop={handleDragStop}
            compactor={noCompactor}
            gridConfig={{
              cols: GRID_COLS,
              rowHeight,
              margin: GRID_MARGIN,
              containerPadding: [0, 0],
              maxRows: GRID_ROWS,
            }}
            dragConfig={{
              enabled: true,
              handle: ".panel-drag-handle",
              cancel: ".panel-no-drag",
              bounded: true,
            }}
            resizeConfig={{
              enabled: true,
              handles: ["n", "ne", "nw", "se", "s", "e", "w", "sw"],
            }}
          >
            {children}
          </GridLayout>
        </>
      )}
    </div>
  );
}

export default WorkspaceLayout;
