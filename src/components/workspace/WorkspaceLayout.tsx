import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import GridLayout, { noCompactor, type Layout } from "react-grid-layout";
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

interface ElementSize {
  width: number;
  height: number;
}

/** Track a host element's content box via ResizeObserver. */
function useElementSize() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const apply = (width: number, height: number) =>
      setSize((prev) =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height },
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

/**
 * The modular workspace surface. Panels are rendered as react-grid-layout
 * items that can be dragged (by their title bar), resized, and snapped onto the
 * column grid. The arrangement is fully controlled by the workspace store, so
 * it round-trips through a serializable JSON schema.
 */
export function WorkspaceLayout({ cwd }: WorkspaceLayoutProps) {
  const panels = useWorkspaceStore((state) => state.panels);
  const grid = useWorkspaceStore((state) => state.grid);
  const setGrid = useWorkspaceStore((state) => state.setGrid);
  const closePanel = useWorkspaceStore((state) => state.closePanel);

  const { ref, width, height } = useElementSize();
  const mounted = width > 0 && height > 0;

  // Derive a row height that makes GRID_ROWS rows fill the available height,
  // so the grid scales with the window instead of scrolling at a fixed size.
  const rowHeight = useMemo(() => {
    const usable = height - (GRID_ROWS - 1) * GRID_MARGIN[1];
    return Math.max(MIN_ROW_HEIGHT, Math.floor(usable / GRID_ROWS));
  }, [height]);

  // Store the exact array RGL emits (same element refs) so the controlled
  // `layout` prop stays referentially equal to RGL's internal state and never
  // triggers a re-sync loop.
  const handleLayoutChange = useCallback(
    (next: Layout) => setGrid([...next]),
    [setGrid],
  );

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
    [panels, cwd, closePanel],
  );

  return (
    <div ref={ref} className="h-full w-full overflow-auto">
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
          compactor={noCompactor}
          gridConfig={{
            cols: GRID_COLS,
            rowHeight,
            margin: GRID_MARGIN,
            containerPadding: [0, 0],
          }}
          dragConfig={{
            enabled: true,
            handle: ".panel-drag-handle",
            cancel: ".panel-no-drag",
          }}
          resizeConfig={{ enabled: true, handles: ["se", "e", "s"] }}
        >
          {children}
        </GridLayout>
      )}
    </div>
  );
}

export default WorkspaceLayout;
