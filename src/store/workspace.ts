/**
 * Active-workspace shim.
 *
 * Historically the workspace layout lived in a single Zustand store. With
 * multiple workspace tabs the source of truth moved to `useWorkspacesStore`
 * (store/workspaces.ts), where each tab owns its own layout. This module keeps
 * the original `useWorkspaceStore` API alive but bound to whichever tab is
 * *active*, so app-level consumers that only ever care about the foreground
 * workspace — the toolbar, command palette, file/content search, presets, and
 * the Loom export bridge — continue to work unchanged.
 *
 * Components rendered once per tab (WorkspaceLayout, PanelFrame) must NOT use
 * this shim; they address their own tab by id through useWorkspacesStore.
 */
import { useWorkspacesStore } from "./workspaces";
import type {
  PanelKind,
  WorkspaceGridItem,
  WorkspacePanel,
} from "../lib/workspaceLayout";

// Stable empty fallbacks so selectors don't see a fresh reference each render.
const EMPTY_PANELS: WorkspacePanel[] = [];
const EMPTY_GRID: WorkspaceGridItem[] = [];
const EMPTY_FONTS: Record<string, number> = {};

export interface ActiveWorkspace {
  panels: WorkspacePanel[];
  grid: WorkspaceGridItem[];
  panelFontSizes: Record<string, number>;
  setGrid: (grid: WorkspaceGridItem[]) => void;
  togglePanel: (kind: PanelKind) => void;
  closePanel: (id: string) => void;
  resetLayout: () => void;
  loadLayout: (panels: WorkspacePanel[], grid: WorkspaceGridItem[]) => void;
  setPanelFontSize: (id: string, size: number) => void;
}

// Module-stable action wrappers that always target the *current* active tab.
// Defined once so selecting one of these never trips Zustand's identity check.
const actions = {
  setGrid: (grid: WorkspaceGridItem[]) => {
    const s = useWorkspacesStore.getState();
    if (s.activeId) s.setGrid(s.activeId, grid);
  },
  togglePanel: (kind: PanelKind) => {
    const s = useWorkspacesStore.getState();
    if (s.activeId) s.togglePanel(s.activeId, kind);
  },
  closePanel: (id: string) => {
    const s = useWorkspacesStore.getState();
    if (s.activeId) s.closePanel(s.activeId, id);
  },
  resetLayout: () => {
    const s = useWorkspacesStore.getState();
    if (s.activeId) s.resetLayout(s.activeId);
  },
  loadLayout: (panels: WorkspacePanel[], grid: WorkspaceGridItem[]) => {
    const s = useWorkspacesStore.getState();
    if (s.activeId) s.loadLayout(s.activeId, panels, grid);
  },
  setPanelFontSize: (id: string, size: number) => {
    const s = useWorkspacesStore.getState();
    if (s.activeId) s.setPanelFontSize(s.activeId, id, size);
  },
};

function buildActive(state: ReturnType<typeof useWorkspacesStore.getState>): ActiveWorkspace {
  const tab = state.tabs.find((t) => t.id === state.activeId);
  return {
    panels: tab?.panels ?? EMPTY_PANELS,
    grid: tab?.grid ?? EMPTY_GRID,
    panelFontSizes: tab?.panelFontSizes ?? EMPTY_FONTS,
    ...actions,
  };
}

/** Read a slice of the active workspace, Zustand-style. */
export function useWorkspaceStore<T>(selector: (s: ActiveWorkspace) => T): T {
  return useWorkspacesStore((state) => selector(buildActive(state)));
}

/** Snapshot the active workspace (for non-React callers like the Loom bridge). */
useWorkspaceStore.getState = (): ActiveWorkspace => buildActive(useWorkspacesStore.getState());

/** Apply panels/grid (and optionally font sizes) to the active workspace. */
useWorkspaceStore.setState = (partial: Partial<ActiveWorkspace>): void => {
  const s = useWorkspacesStore.getState();
  if (!s.activeId) return;
  if (partial.panels && partial.grid) {
    s.loadLayout(s.activeId, partial.panels, partial.grid, partial.panelFontSizes);
  }
};
