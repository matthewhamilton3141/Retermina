import { useCallback, useMemo } from "react";
import GridLayout, {
  useContainerWidth,
  type Layout,
} from "react-grid-layout";
import { getCompactor } from "react-grid-layout/core";
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
  /** Working directory of the active workspace (null = blank terminal). */
  cwd: string | null;
}

/**
 * The modular workspace surface. Panels are rendered as react-grid-layout
 * (v2 API) items that can be dragged (by their title bar), resized, and
 * snapped onto the column grid. The arrangement is fully controlled by the
 * workspace store, so it round-trips through a serializable JSON schema.
 */
export function WorkspaceLayout({ cwd }: WorkspaceLayoutProps) {
  const panels = useWorkspaceStore((state) => state.panels);
  const grid = useWorkspaceStore((state) => state.grid);
  const setGrid = useWorkspaceStore((state) => state.setGrid);
  const closePanel = useWorkspaceStore((state) => state.closePanel);

  // v2's required width measurement. containerRef goes on the host element;
  // `mounted` flips true once the first ResizeObserver measurement lands, so
  // we never hand GridLayout a width of 0 (which would crush every panel).
  const { width, containerRef, mounted } = useContainerWidth();

  // Derive a row height that makes GRID_ROWS rows fill the available height
  // of the *host* element, so the grid scales with the window instead of
  // overflowing or leaving dead space. We read the live height off the ref
  // each render rather than via a second observer, since useContainerWidth
  // already re-renders us on size changes.
  const rowHeight = useMemo(() => {
    const hostHeight = containerRef.current?.clientHeight ?? 0;
    const usable = hostHeight - (GRID_ROWS - 1) * GRID_MARGIN[1];
    return Math.max(MIN_ROW_HEIGHT, Math.floor(usable / GRID_ROWS));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, containerRef.current?.clientHeight]);

  // Persist the exact array RGL emits so the controlled `layout` prop stays
  // referentially close to RGL's internal state.
  const handleLayoutChange = useCallback(
    (next: Layout) => setGrid([...next]),
    [setGrid],
  );

  // Free positioning: panels stay exactly where dropped/resized (no
  // auto-compaction — CompactType `null` = noCompactor), but collisions are
  // still blocked so one panel can never be dragged on top of / hidden
  // behind another.
  const compactor = useMemo(() => getCompactor(null, false, true), []);

  // Rebuild children only when the panel set or cwd changes — never on
  // drag/resize — so the live terminal subtree is preserved across moves.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panels, cwd, closePanel],
  );

  return (
    <div ref={containerRef} className="h-full w-full overflow-auto">
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
          gridConfig={{
            cols: GRID_COLS,
            rowHeight,
            margin: GRID_MARGIN,
            containerPadding: [0, 0],
            // Hard-cap the grid height to GRID_ROWS so a panel can never be
            // dragged/resized below the visible area and become unreachable.
            maxRows: GRID_ROWS,
          }}
          dragConfig={{
            enabled: true,
            handle: ".panel-drag-handle",
            cancel: ".panel-no-drag",
            // Keep panels from being dragged outside the grid container.
            bounded: true,
          }}
          resizeConfig={{
            enabled: true,
            handles: ["se", "e", "s"],
          }}
          // Free positioning: panels stay exactly where dropped/resized
          // (no auto-compaction), but collisions are still blocked so one
          // panel can never be dragged on top of / hidden behind another.
          compactor={compactor}
        >
          {children}
        </GridLayout>
      )}
    </div>
  );
}

export default WorkspaceLayout;