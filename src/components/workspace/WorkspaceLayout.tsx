/**
 * WorkspaceLayout — the RGL-powered panel grid.
 *
 * react-grid-layout is the sole engine for panel positioning, drag, and
 * resize. The grid is fully controlled: layout state lives in the Zustand
 * workspace store and every change (drag, resize, toggle) flows back through
 * onLayoutChange → setGrid. noCompactor keeps panels static between
 * explicit user actions.
 *
 * During drag, RGL renders its own .react-grid-placeholder at the correct
 * drop position. No custom pixel-positioned overlay is needed or used.
 *
 * Collision resolution (handleDragStop) runs after every drop:
 *   1. Resize  — shrink the displaced panel along the overlapping edge.
 *   2. Swap    — move it to the drag origin if resize isn't possible.
 *   3. Abort   — snap the dragged panel back if neither is valid.
 */
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

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isInBounds(item: { w: number; h: number }, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x + item.w <= GRID_COLS && y + item.h <= GRID_ROWS;
}

/**
 * Try to shrink `displaced` so it no longer overlaps `priority`.
 * Generates one candidate per overlapping edge, returns the one that
 * preserves the most area, or null if every direction violates minW/minH.
 */
function tryResizeToFit(
  displaced: LayoutItem,
  priority: LayoutItem,
): LayoutItem | null {
  const minW = displaced.minW ?? 1;
  const minH = displaced.minH ?? 1;
  const candidates: LayoutItem[] = [];

  if (displaced.x < priority.x && displaced.x + displaced.w > priority.x) {
    const newW = priority.x - displaced.x;
    if (newW >= minW) candidates.push({ ...displaced, w: newW });
  }
  if (
    displaced.x < priority.x + priority.w &&
    displaced.x + displaced.w > priority.x + priority.w
  ) {
    const newX = priority.x + priority.w;
    const newW = displaced.x + displaced.w - newX;
    if (newW >= minW && newX + newW <= GRID_COLS)
      candidates.push({ ...displaced, x: newX, w: newW });
  }
  if (displaced.y < priority.y && displaced.y + displaced.h > priority.y) {
    const newH = priority.y - displaced.y;
    if (newH >= minH) candidates.push({ ...displaced, h: newH });
  }
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
  return candidates.reduce((best, c) => (c.w * c.h > best.w * best.h ? c : best));
}

/**
 * Z-index for a panel during a drag gesture.
 * Expressed in CSS (.react-draggable-dragging { z-index: 999 }) so the
 * memoized children divs are never mutated mid-gesture.
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

  // Snapshot the full layout when a drag begins so handleDragStop can
  // identify displaced panels by their pre-drag positions.
  const preDragRef = useRef<Layout>([]);

  const clamp = useCallback(
    (item: LayoutItem): LayoutItem => ({
      ...item,
      x: Math.max(0, Math.min(item.x, GRID_COLS - item.w)),
      y: Math.max(0, Math.min(item.y, GRID_ROWS - item.h)),
    }),
    [],
  );

  const handleDragStart = useCallback((layout: Layout) => {
    preDragRef.current = [...layout];
  }, []);

  /**
   * Collision resolution on drop.
   *
   * RGL with noCompactor leaves displaced panels where they end up after its
   * internal collision pass (which can push them outside maxRows). We intercept
   * here and apply: resize → swap → abort, using the pre-drag snapshot so the
   * correct panel is identified regardless of where RGL moved it.
   */
  const handleDragStop = useCallback(
    (_layout: Layout, oldItem: LayoutItem | null, newItem: LayoutItem | null) => {
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

      const resolutions = new Map<string, LayoutItem>();
      let abort = false;

      for (const d of displaced) {
        const orig = pre.find((p) => p.i === d.i) ?? d;

        const resized = tryResizeToFit(orig, newItem);
        if (resized) { resolutions.set(d.i, clamp(resized)); continue; }

        if (isInBounds(orig, oldItem.x, oldItem.y)) {
          resolutions.set(d.i, clamp({ ...orig, x: oldItem.x, y: oldItem.y }));
          continue;
        }

        abort = true;
        break;
      }

      if (abort) {
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
        _layout.map((item) => resolutions.get(item.i) ?? clamp(item)),
      );
    },
    [setGrid, clamp],
  );

  const handleLayoutChange = useCallback(
    (next: Layout) => setGrid(next.map(clamp)),
    [setGrid, clamp],
  );

  // Memoized children — never rebuilt on drag/resize so live terminals
  // survive grid gestures without remounting.
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
              panelId={panel.id}
              onClose={() => closePanel(panel.id)}
            >
              {renderer({ cwd })}
            </PanelFrame>
          </div>
        );
      }),
    [panels, cwd, closePanel],
  );

  return (
    <div ref={ref} className="h-full w-full overflow-hidden">
      {!mounted ? null : panels.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center px-6 text-center">
          <p className="rt-text-muted text-sm">
            All panels are hidden. Use the toolbar above to bring one back.
          </p>
        </div>
      ) : (
        <GridLayout
          className="retermina-grid"
          width={width}
          layout={grid}
          onLayoutChange={handleLayoutChange}
          onDragStart={handleDragStart}
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
      )}
    </div>
  );
}

export default WorkspaceLayout;
