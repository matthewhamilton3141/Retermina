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

/** Ghost indicator rendered during drag. */
interface SwapGhost {
  x: number; y: number; w: number; h: number;
  /**
   * "resize" — the displaced panel will be shrunk to fit.
   * "swap"   — the displaced panel will move to the drag origin.
   * "abort"  — no valid resolution; drop will be rejected (red).
   */
  resolution: "resize" | "swap" | "abort";
}

// ---------------------------------------------------------------------------
// Pure helpers (outside component — stable refs, no closure deps)
// ---------------------------------------------------------------------------

function isInBounds(item: { w: number; h: number }, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x + item.w <= GRID_COLS && y + item.h <= GRID_ROWS;
}

/**
 * Try to shrink `displaced` so it no longer overlaps `priority`, while
 * respecting minW / minH. Returns the resized item, or null if every cut
 * direction would violate the minimum size constraint.
 *
 * Strategy: generate all valid single-edge cuts, pick the one that
 * preserves the most area (minimum disruption to the displaced panel).
 */
function tryResizeToFit(
  displaced: LayoutItem,
  priority: LayoutItem,
): LayoutItem | null {
  const minW = displaced.minW ?? 1;
  const minH = displaced.minH ?? 1;
  const candidates: LayoutItem[] = [];

  // Displaced extends too far to the RIGHT (priority is to its right)
  if (displaced.x < priority.x && displaced.x + displaced.w > priority.x) {
    const newW = priority.x - displaced.x;
    if (newW >= minW) candidates.push({ ...displaced, w: newW });
  }

  // Displaced extends too far to the LEFT (priority starts further left)
  if (
    displaced.x < priority.x + priority.w &&
    displaced.x + displaced.w > priority.x + priority.w
  ) {
    const newX = priority.x + priority.w;
    const newW = displaced.x + displaced.w - newX;
    if (newW >= minW && newX + newW <= GRID_COLS)
      candidates.push({ ...displaced, x: newX, w: newW });
  }

  // Displaced extends too far DOWN (priority is above)
  if (displaced.y < priority.y && displaced.y + displaced.h > priority.y) {
    const newH = priority.y - displaced.y;
    if (newH >= minH) candidates.push({ ...displaced, h: newH });
  }

  // Displaced extends too far UP (priority starts higher)
  if (
    displaced.y < priority.y + priority.h &&
    displaced.y + displaced.h > priority.y + priority.h
  ) {
    const newY = priority.y + priority.h;
    const newH = displaced.y + displaced.h - newY;
    if (newH >= minH && newY + newH <= GRID_ROWS)
      candidates.push({ ...displaced, y: newY, h: newH });
  }

  if (candidates.length === 0) return null;

  // Prefer the candidate that preserves the most panel area.
  return candidates.reduce((best, c) =>
    c.w * c.h > best.w * best.h ? c : best,
  );
}

/**
 * Return the z-index for `panelId` during a drag gesture.
 * Applied via CSS (`.react-draggable-dragging { z-index: 999 }`) so the
 * memoized children divs are never touched during the gesture.
 */
export function getPanelZIndex(panelId: string, draggingId: string | null): number {
  return panelId === draggingId ? 999 : 10;
}

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
  const panels     = useWorkspaceStore((s) => s.panels);
  const grid       = useWorkspaceStore((s) => s.grid);
  const setGrid    = useWorkspaceStore((s) => s.setGrid);
  const closePanel = useWorkspaceStore((s) => s.closePanel);

  const { ref, width, height } = useElementSize();
  const mounted = width > 0 && height > 0;

  const rowHeight = useMemo(() => {
    const usable = height - (GRID_ROWS - 1) * GRID_MARGIN[1];
    return Math.max(MIN_ROW_HEIGHT, Math.floor(usable / GRID_ROWS));
  }, [height]);

  const preDragRef = useRef<Layout>([]);
  const [swapGhost, setSwapGhost] = useState<SwapGhost | null>(null);

  // ── Clamp ─────────────────────────────────────────────────────────────────

  const clamp = useCallback(
    (item: LayoutItem): LayoutItem => ({
      ...item,
      x: Math.max(0, Math.min(item.x, GRID_COLS - item.w)),
      y: Math.max(0, Math.min(item.y, GRID_ROWS - item.h)),
    }),
    [],
  );

  /** Convert a ghost's grid coords to CSS pixels for the overlay div. */
  const ghostPixels = useMemo(() => {
    if (!swapGhost || width === 0) return null;
    const colW = (width - (GRID_COLS - 1) * GRID_MARGIN[0]) / GRID_COLS;
    return {
      left:   swapGhost.x * (colW + GRID_MARGIN[0]),
      top:    swapGhost.y * (rowHeight + GRID_MARGIN[1]),
      width:  swapGhost.w * colW + (swapGhost.w - 1) * GRID_MARGIN[0],
      height: swapGhost.h * rowHeight + (swapGhost.h - 1) * GRID_MARGIN[1],
      resolution: swapGhost.resolution,
    };
  }, [swapGhost, width, rowHeight]);

  // ── Drag handlers ─────────────────────────────────────────────────────────

  const handleDragStart = useCallback((layout: Layout) => {
    preDragRef.current = [...layout];
    setSwapGhost(null);
  }, []);

  /**
   * Each drag frame: find the displaced panel, compute the best resolution,
   * and render the ghost showing what will happen on drop.
   *
   *   Resize → ghost shows displaced panel's future shrunken bounds (green)
   *   Swap   → ghost shows displaced panel at drag origin (green)
   *   Abort  → ghost shows displaced panel at current position (red)
   */
  const handleDrag = useCallback(
    (_layout: Layout, oldItem: LayoutItem | null, newItem: LayoutItem | null) => {
      if (!newItem || !oldItem) { setSwapGhost(null); return; }

      const pre = preDragRef.current;
      const origin = pre.find((i) => i.i === newItem.i) ?? oldItem;

      // Which pre-drag panel is under the current drag position?
      const target = pre.find(
        (item) =>
          item.i !== newItem.i &&
          newItem.x < item.x + item.w &&
          newItem.x + newItem.w > item.x &&
          newItem.y < item.y + item.h &&
          newItem.y + newItem.h > item.y,
      );

      if (!target) { setSwapGhost(null); return; }

      // Try resize first.
      const resized = tryResizeToFit(target, newItem);
      if (resized) {
        setSwapGhost({
          x: resized.x, y: resized.y,
          w: resized.w, h: resized.h,
          resolution: "resize",
        });
        return;
      }

      // Fall back to swap.
      const swapValid = isInBounds(target, origin.x, origin.y);
      setSwapGhost({
        x: swapValid ? origin.x : target.x,
        y: swapValid ? origin.y : target.y,
        w: target.w, h: target.h,
        resolution: swapValid ? "swap" : "abort",
      });
    },
    [],
  );

  /**
   * On drop: for each displaced panel attempt resize → swap → abort in order.
   * If any displaced panel cannot be resolved, the entire drop is aborted and
   * the dragged panel snaps back to its origin.
   */
  const handleDragStop = useCallback(
    (_layout: Layout, oldItem: LayoutItem | null, newItem: LayoutItem | null) => {
      setSwapGhost(null);
      if (!oldItem || !newItem) return;

      const pre = preDragRef.current;

      const displaced = pre.filter(
        (item) =>
          item.i !== newItem.i &&
          newItem.x < item.x + item.w &&
          newItem.x + newItem.w > item.x &&
          newItem.y < item.y + item.h &&
          newItem.y + newItem.h > item.y,
      );

      if (displaced.length === 0) {
        setGrid(_layout.map(clamp));
        return;
      }

      // Compute resolution for each displaced panel.
      const resolutions = new Map<string, LayoutItem>();
      let abort = false;

      for (const d of displaced) {
        const orig = pre.find((p) => p.i === d.i) ?? d;

        const resized = tryResizeToFit(orig, newItem);
        if (resized) {
          resolutions.set(d.i, clamp(resized));
          continue;
        }

        if (isInBounds(orig, oldItem.x, oldItem.y)) {
          resolutions.set(d.i, clamp({ ...orig, x: oldItem.x, y: oldItem.y }));
          continue;
        }

        abort = true;
        break;
      }

      if (abort) {
        // Return the dragged panel to its origin; leave everything else clamped.
        setGrid(
          _layout.map((item) =>
            item.i === newItem.i
              ? clamp({ ...item, x: oldItem.x, y: oldItem.y })
              : clamp(item),
          ),
        );
        return;
      }

      setGrid(
        _layout.map((item) => {
          const resolved = resolutions.get(item.i);
          return resolved ?? clamp(item);
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

  const ghostColor = ghostPixels
    ? ghostPixels.resolution === "abort"
      ? { border: "#ef4444", bg: "rgba(239,68,68,0.12)" }
      : ghostPixels.resolution === "resize"
      ? { border: "var(--rt-accent)", bg: "rgba(74,111,165,0.1)" }
      : { border: "var(--rt-accent)", bg: "var(--rt-accent-soft)" }
    : null;

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
          {ghostPixels && ghostColor && (
            <div
              className="pointer-events-none absolute z-50"
              style={{
                left:            ghostPixels.left,
                top:             ghostPixels.top,
                width:           ghostPixels.width,
                height:          ghostPixels.height,
                borderRadius:    "var(--rt-radius-lg)",
                border:          `2px dashed ${ghostColor.border}`,
                backgroundColor: ghostColor.bg,
                transition:      "none",
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
