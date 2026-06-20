import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  DEFAULT_PANEL_SIZE,
  GRID_COLS,
  PANEL_IDS,
  PANEL_META,
  WORKSPACE_LAYOUT_VERSION,
  createDefaultWorkspaceLayout,
  findFreeSlot,
  isWorkspaceGridArray,
  isWorkspacePanelArray,
  sanitizeGridItem,
  type PanelKind,
  type WorkspaceGridItem,
  type WorkspacePanel,
} from "../lib/workspaceLayout";

interface WorkspaceLayoutState {
  /** Visible panels, in render order. */
  panels: WorkspacePanel[];
  /**
   * Grid coordinates/sizes for each panel. At runtime these hold the exact
   * items react-grid-layout emits (enriched with its own bookkeeping fields);
   * persistence strips them back to the serializable schema via `partialize`.
   */
  grid: WorkspaceGridItem[];
  /** Replace the grid after a drag/resize (called from onLayoutChange). */
  setGrid: (grid: WorkspaceGridItem[]) => void;
  /** Show or hide a panel by kind. */
  togglePanel: (kind: PanelKind) => void;
  /** Remove a panel by id (panel close button). */
  closePanel: (id: string) => void;
  /** Restore the default arrangement. */
  resetLayout: () => void;
}

export const useWorkspaceStore = create<WorkspaceLayoutState>()(
  persist(
    (set) => {
      const defaults = createDefaultWorkspaceLayout();
      return {
        panels: defaults.panels,
        grid: defaults.grid,
        setGrid: (grid) => set({ grid }),
        togglePanel: (kind) =>
          set((state) => {
            const id = PANEL_IDS[kind];
            const isVisible = state.panels.some((panel) => panel.id === id);
            if (isVisible) {
              return {
                panels: state.panels.filter((panel) => panel.id !== id),
                grid: state.grid.filter((item) => item.i !== id),
              };
            }
            const size = DEFAULT_PANEL_SIZE[kind];
            const w = Math.min(size.w, GRID_COLS);
            const h = size.h;
            // Find an empty gap in the visible grid instead of stacking
            // below the last row — that could push the panel off screen
            // where the user would never see it appear.
            const { x, y } = findFreeSlot(state.grid, w, h);

            const item: WorkspaceGridItem = {
              i: id,
              x,
              y,
              w,
              h,
              minW: size.minW,
              minH: size.minH,
            };
            return {
              panels: [
                ...state.panels,
                { id, kind, title: PANEL_META[kind].label },
              ],
              grid: [...state.grid, item],
            };
          }),
        closePanel: (id) =>
          set((state) => ({
            panels: state.panels.filter((panel) => panel.id !== id),
            grid: state.grid.filter((item) => item.i !== id),
          })),
        resetLayout: () => {
          const fresh = createDefaultWorkspaceLayout();
          set({ panels: fresh.panels, grid: fresh.grid });
        },
      };
    },
    {
      name: "retermina.workspace-layout",
      version: WORKSPACE_LAYOUT_VERSION,
      // Persist only the serializable schema fields, dropping RGL bookkeeping.
      partialize: (state) => ({
        panels: state.panels,
        grid: state.grid.map(sanitizeGridItem),
      }),
      // Reject corrupt/partial persisted state and fall back to the defaults
      // that ship in the freshly-initialized store.
      merge: (persisted, current) => {
        const data = persisted as Partial<WorkspaceLayoutState> | undefined;
        if (
          data &&
          isWorkspacePanelArray(data.panels) &&
          data.panels.length > 0 &&
          isWorkspaceGridArray(data.grid)
        ) {
          return { ...current, panels: data.panels, grid: data.grid };
        }
        return current;
      },
    },
  ),
);
