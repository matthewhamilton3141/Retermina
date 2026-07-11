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
 * Collision resolution on drop lives in lib/gridCollision (resolveDrop):
 * swap → resize → relocate → abort, always validated against the whole
 * layout before committing.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import GridLayout, { noCompactor, type Layout, type LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import PanelFrame from "./PanelFrame";
import { PANEL_RENDERERS } from "./panels";
import { useWorkspacesStore } from "../../store/workspaces";
import { clampToGrid, resolveDrop } from "../../lib/gridCollision";
import {
  GRID_COLS,
  GRID_MARGIN,
  GRID_ROWS,
  MIN_ROW_HEIGHT,
  PANEL_META,
  type WorkspaceGridItem,
  type WorkspacePanel,
} from "../../lib/workspaceLayout";

export interface WorkspaceLayoutProps {
  /** The tab whose layout this grid renders. */
  workspaceId: string;
  cwd: string | null;
  /** Whether this tab is the foreground one (drives Iris bus ownership). */
  active: boolean;
}

const EMPTY_PANELS: WorkspacePanel[] = [];
const EMPTY_GRID: WorkspaceGridItem[] = [];

interface ElementSize {
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

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

export function WorkspaceLayout({ workspaceId, cwd, active }: WorkspaceLayoutProps) {
  const panels      = useWorkspacesStore((s) => s.tabs.find((t) => t.id === workspaceId)?.panels ?? EMPTY_PANELS);
  const grid        = useWorkspacesStore((s) => s.tabs.find((t) => t.id === workspaceId)?.grid ?? EMPTY_GRID);
  const focusedId   = useWorkspacesStore((s) => s.tabs.find((t) => t.id === workspaceId)?.focusedId ?? null);
  const setGridRaw  = useWorkspacesStore((s) => s.setGrid);
  const closePanelRaw = useWorkspacesStore((s) => s.closePanel);
  const resetLayoutRaw = useWorkspacesStore((s) => s.resetLayout);
  const setFocusedRaw = useWorkspacesStore((s) => s.setFocusedPanel);

  const setGrid    = useCallback((g: WorkspaceGridItem[]) => setGridRaw(workspaceId, g), [setGridRaw, workspaceId]);
  const closePanel = useCallback((id: string) => closePanelRaw(workspaceId, id), [closePanelRaw, workspaceId]);
  const setFocused = useCallback((id: string | null) => setFocusedRaw(workspaceId, id), [setFocusedRaw, workspaceId]);

  const { ref, width, height } = useElementSize();
  const mounted = width > 0 && height > 0;

  // Panel focus mode — when set, that panel is maximized to fill the grid and
  // its siblings are hidden (via CSS keyed off the classes below). All panels
  // stay mounted so their PTYs keep running. Persisted per tab (see the store's
  // `focusedId`) so reopening the app restores whichever panel was focused.
  const toggleFocus = useCallback(
    (id: string) => setFocused(focusedId === id ? null : id),
    [setFocused, focusedId],
  );

  // Drop focus if the focused panel is closed/removed. The store clears focus at
  // each removal path too; this is a belt-and-suspenders guard for any it misses.
  useEffect(() => {
    if (focusedId && !panels.some((p) => p.id === focusedId)) setFocused(null);
  }, [panels, focusedId, setFocused]);

  // Esc exits focus mode (only for the foreground tab).
  useEffect(() => {
    if (!focusedId || !active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFocused(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedId, active, setFocused]);

  const rowHeight = useMemo(() => {
    const usable = height - (GRID_ROWS - 1) * GRID_MARGIN[1];
    return Math.max(MIN_ROW_HEIGHT, Math.floor(usable / GRID_ROWS));
  }, [height]);

  // Snapshot the full layout when a drag begins so handleDragStop can
  // identify displaced panels by their pre-drag positions.
  const preDragRef = useRef<Layout>([]);
  // While a drag is in flight (and for one frame after the drop commits),
  // onLayoutChange must not write RGL's internal layout into the store — it
  // fires after onDragStop and would clobber the drop resolution with the
  // unresolved (possibly overlapping) positions.
  const dragActiveRef = useRef(false);

  const handleDragStart = useCallback((layout: Layout) => {
    dragActiveRef.current = true;
    preDragRef.current = [...layout];
  }, []);

  /**
   * Collision resolution on drop — delegated to resolveDrop (swap → resize →
   * relocate → abort). RGL with noCompactor leaves displaced panels where its
   * internal collision pass shoved them (possibly outside maxRows), so the
   * result is always rebuilt from the pre-drag snapshot; a null resolution
   * restores that snapshot wholesale, snapping the drag back.
   */
  const handleDragStop = useCallback(
    (_layout: Layout, oldItem: LayoutItem | null, newItem: LayoutItem | null) => {
      if (!oldItem || !newItem) {
        dragActiveRef.current = false;
        return;
      }
      const pre = preDragRef.current;
      setGrid(resolveDrop(pre, oldItem, newItem) ?? pre.map(clampToGrid));
      // Lift the suppression only after RGL's post-drop onLayoutChange burst.
      requestAnimationFrame(() => { dragActiveRef.current = false; });
    },
    [setGrid],
  );

  const handleLayoutChange = useCallback(
    (next: Layout) => {
      if (dragActiveRef.current) return;
      setGrid(next.map(clampToGrid));
    },
    [setGrid],
  );

  // Memoized children — never rebuilt on drag/resize so live terminals
  // survive grid gestures without remounting.
  const children = useMemo(
    () =>
      panels.map((panel) => {
        const renderer = PANEL_RENDERERS[panel.kind];
        if (!renderer) return null;
        const isFocused = focusedId === panel.id;
        return (
          <div key={panel.id} className={isFocused ? "overflow-hidden rt-panel-focused" : "overflow-hidden"}>
            <PanelFrame
              icon={PANEL_META[panel.kind].icon}
              title={panel.title}
              workspaceId={workspaceId}
              panelId={panel.id}
              onClose={() => closePanel(panel.id)}
              focused={isFocused}
              onToggleFocus={() => toggleFocus(panel.id)}
            >
              {renderer({ cwd, workspaceId, active })}
            </PanelFrame>
          </div>
        );
      }),
    [panels, cwd, closePanel, workspaceId, active, focusedId, toggleFocus],
  );

  return (
    <div ref={ref} className="h-full w-full overflow-hidden">
      {!mounted ? null : panels.length === 0 ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="rt-text-muted text-sm">
            All panels are hidden. Toggle one from the toolbar, or:
          </p>
          <button
            type="button"
            onClick={() => resetLayoutRaw(workspaceId)}
            className="rt-btn-outline px-3 py-1.5 text-sm font-medium"
          >
            Restore default layout
          </button>
        </div>
      ) : (
        <GridLayout
          className={focusedId ? "retermina-grid rt-has-focus" : "retermina-grid"}
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
            // Disable drag/resize while a panel is maximized.
            enabled: !focusedId,
            handle: ".panel-drag-handle",
            cancel: ".panel-no-drag",
            bounded: true,
          }}
          resizeConfig={{
            enabled: !focusedId,
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
