/**
 * Multi-tab workspaces store.
 *
 * Each open workspace ("tab") owns its own cwd plus an independent panel
 * layout (panels + grid + per-panel font sizes). Switching tabs never tears
 * any tab down — TerminalWorkspace keeps every tab mounted and just hides the
 * inactive ones — so the live PTYs inside a backgrounded tab keep running.
 *
 * The legacy single-workspace store (`useWorkspaceStore`) is now a thin shim
 * over the *active* tab of this store; see store/workspace.ts. Components that
 * are rendered once per tab (WorkspaceLayout, PanelFrame) address their tab by
 * id directly instead of going through that active-tab shim.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { prettyPath } from "../lib/format";
import {
  DEFAULT_PANEL_SIZE,
  GRID_COLS,
  PANEL_IDS,
  PANEL_META,
  createDefaultWorkspaceLayout,
  findFreeSlot,
  fitIntoColumn,
  isWorkspaceGridArray,
  isWorkspacePanelArray,
  sanitizeGridItem,
  type PanelKind,
  type WorkspaceGridItem,
  type WorkspacePanel,
} from "../lib/workspaceLayout";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceTab {
  id: string;
  cwd: string | null;
  title: string;
  panels: WorkspacePanel[];
  grid: WorkspaceGridItem[];
  /** Per-panel font size as a percentage (70–150, default 100). */
  panelFontSizes: Record<string, number>;
}

interface WorkspacesState {
  tabs: WorkspaceTab[];
  activeId: string | null;

  // ── Tab management ────────────────────────────────────────────────────────
  /** Activate the tab matching `cwd`, or create one if none exists. Returns its id. */
  openWorkspace: (cwd?: string | null) => string;
  /** Always create a fresh tab (used by the "+" new-tab button). Returns its id. */
  newWorkspace: (cwd?: string | null) => string;
  closeWorkspace: (id: string) => void;
  setActive: (id: string) => void;

  // ── Per-tab layout ops (all addressed by tab id) ──────────────────────────
  setGrid: (id: string, grid: WorkspaceGridItem[]) => void;
  togglePanel: (id: string, kind: PanelKind) => void;
  closePanel: (id: string, panelId: string) => void;
  resetLayout: (id: string) => void;
  loadLayout: (
    id: string,
    panels: WorkspacePanel[],
    grid: WorkspaceGridItem[],
    panelFontSizes?: Record<string, number>,
  ) => void;
  setPanelFontSize: (id: string, panelId: string, size: number) => void;
  /** Append a fresh terminal panel to a free grid slot. Used by split pop-out. */
  addTerminalPanel: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const newId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

const titleFor = (cwd: string | null) => (cwd ? prettyPath(cwd) : "Blank Terminal");

function makeTab(cwd: string | null): WorkspaceTab {
  const layout = createDefaultWorkspaceLayout();
  return {
    id: newId(),
    cwd,
    title: titleFor(cwd),
    panels: layout.panels,
    grid: layout.grid,
    panelFontSizes: {},
  };
}

/** Immutably replace the tab with `id`, applying `fn` to it. */
function patch(
  tabs: WorkspaceTab[],
  id: string,
  fn: (tab: WorkspaceTab) => WorkspaceTab,
): WorkspaceTab[] {
  return tabs.map((tab) => (tab.id === id ? fn(tab) : tab));
}

/** Toggle a built-in singleton panel within one tab's layout. */
function togglePanelInTab(
  tab: WorkspaceTab,
): (kind: PanelKind) => Pick<WorkspaceTab, "panels" | "grid"> {
  return (kind) => {
    const id = PANEL_IDS[kind];
    const isVisible = tab.panels.some((p) => p.id === id);

    if (isVisible) {
      return {
        panels: tab.panels.filter((p) => p.id !== id),
        grid: tab.grid.filter((item) => item.i !== id),
      };
    }

    // Showing: prefer a genuinely free slot; otherwise share the natural column.
    const size = DEFAULT_PANEL_SIZE[kind];
    const w = Math.min(size.w, GRID_COLS);
    const h = size.h;
    const slot = findFreeSlot(tab.grid, w, h);
    const slotOccupied = tab.grid.some(
      (item) =>
        slot.x < item.x + item.w &&
        slot.x + w > item.x &&
        slot.y < item.y + item.h &&
        slot.y + h > item.y,
    );

    const grid = slotOccupied
      ? fitIntoColumn(tab.grid, id, kind)
      : [
          ...tab.grid,
          { i: id, x: slot.x, y: slot.y, w, h, minW: size.minW, minH: size.minH },
        ];

    return {
      panels: [...tab.panels, { id, kind, title: PANEL_META[kind].label }],
      grid,
    };
  };
}

/**
 * Seed the initial tab list. On the very first launch under the multi-tab
 * model we adopt any layout left behind by the legacy single-workspace store
 * so existing users don't lose their arrangement.
 */
function seedTabs(): WorkspaceTab[] {
  try {
    const raw = localStorage.getItem("retermina.workspace-layout");
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { panels?: unknown; grid?: unknown } };
      const panels = parsed?.state?.panels;
      const grid = parsed?.state?.grid;
      if (
        isWorkspacePanelArray(panels) &&
        panels.length > 0 &&
        isWorkspaceGridArray(grid)
      ) {
        return [
          {
            id: newId(),
            cwd: null,
            title: titleFor(null),
            panels,
            grid: grid.map(sanitizeGridItem),
            panelFontSizes: {},
          },
        ];
      }
    }
  } catch {
    // Corrupt/absent legacy state — fall through to a default tab.
  }
  return [makeTab(null)];
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const WORKSPACES_VERSION = 1;

export const useWorkspacesStore = create<WorkspacesState>()(
  persist(
    (set, get) => {
      const initialTabs = seedTabs();
      return {
        tabs: initialTabs,
        activeId: initialTabs[0]?.id ?? null,

        openWorkspace: (cwd = null) => {
          const existing = get().tabs.find((t) => t.cwd === cwd);
          if (existing) {
            set({ activeId: existing.id });
            return existing.id;
          }
          const tab = makeTab(cwd);
          set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
          return tab.id;
        },

        newWorkspace: (cwd = null) => {
          const tab = makeTab(cwd);
          set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
          return tab.id;
        },

        closeWorkspace: (id) =>
          set((s) => {
            const idx = s.tabs.findIndex((t) => t.id === id);
            if (idx === -1) return s;
            const tabs = s.tabs.filter((t) => t.id !== id);
            let activeId = s.activeId;
            if (s.activeId === id) {
              const neighbour = tabs[idx] ?? tabs[idx - 1] ?? tabs[0] ?? null;
              activeId = neighbour?.id ?? null;
            }
            return { tabs, activeId };
          }),

        setActive: (id) => set({ activeId: id }),

        setGrid: (id, grid) => set((s) => ({ tabs: patch(s.tabs, id, (t) => ({ ...t, grid })) })),

        togglePanel: (id, kind) =>
          set((s) => ({
            tabs: patch(s.tabs, id, (t) => ({ ...t, ...togglePanelInTab(t)(kind) })),
          })),

        closePanel: (id, panelId) =>
          set((s) => ({
            tabs: patch(s.tabs, id, (t) => ({
              ...t,
              panels: t.panels.filter((p) => p.id !== panelId),
              grid: t.grid.filter((item) => item.i !== panelId),
            })),
          })),

        resetLayout: (id) =>
          set((s) => ({
            tabs: patch(s.tabs, id, (t) => {
              const fresh = createDefaultWorkspaceLayout();
              return { ...t, panels: fresh.panels, grid: fresh.grid };
            }),
          })),

        loadLayout: (id, panels, grid, panelFontSizes) =>
          set((s) => ({
            tabs: patch(s.tabs, id, (t) => ({
              ...t,
              panels,
              grid: grid.map(sanitizeGridItem),
              panelFontSizes: panelFontSizes ?? t.panelFontSizes,
            })),
          })),

        setPanelFontSize: (id, panelId, size) =>
          set((s) => ({
            tabs: patch(s.tabs, id, (t) => ({
              ...t,
              panelFontSizes: {
                ...t.panelFontSizes,
                [panelId]: Math.max(70, Math.min(150, size)),
              },
            })),
          })),

        addTerminalPanel: (id) =>
          set((s) => ({
            tabs: patch(s.tabs, id, (t) => {
              const size = DEFAULT_PANEL_SIZE.terminal;
              const w = Math.min(size.w, GRID_COLS);
              const h = size.h;
              const panelId = `terminal-${newId().slice(0, 8)}`;
              const slot = findFreeSlot(t.grid, w, h);
              const slotOccupied = t.grid.some(
                (item) =>
                  slot.x < item.x + item.w &&
                  slot.x + w > item.x &&
                  slot.y < item.y + item.h &&
                  slot.y + h > item.y,
              );
              // Drop into genuine free space when there is some; otherwise share
              // the terminal column rather than landing on top of another panel.
              const grid = slotOccupied
                ? fitIntoColumn(t.grid, panelId, "terminal")
                : [
                    ...t.grid,
                    { i: panelId, x: slot.x, y: slot.y, w, h, minW: size.minW, minH: size.minH },
                  ];
              return {
                ...t,
                panels: [
                  ...t.panels,
                  { id: panelId, kind: "terminal", title: PANEL_META.terminal.label },
                ],
                grid,
              };
            }),
          })),
      };
    },
    {
      name: "retermina.workspaces",
      version: WORKSPACES_VERSION,
      partialize: (state) => ({
        tabs: state.tabs.map((t) => ({
          id: t.id,
          cwd: t.cwd,
          title: t.title,
          panels: t.panels,
          grid: t.grid.map(sanitizeGridItem),
          panelFontSizes: t.panelFontSizes,
        })),
        activeId: state.activeId,
      }),
      // Reject corrupt persisted state and fall back to a freshly seeded tab.
      merge: (persisted, current) => {
        const data = persisted as Partial<WorkspacesState> | undefined;
        const tabs = Array.isArray(data?.tabs) ? data!.tabs : [];
        const valid = tabs.filter(
          (t): t is WorkspaceTab =>
            !!t &&
            typeof t.id === "string" &&
            isWorkspacePanelArray(t.panels) &&
            isWorkspaceGridArray(t.grid),
        );
        if (valid.length === 0) return current;
        const activeId =
          typeof data?.activeId === "string" && valid.some((t) => t.id === data.activeId)
            ? data.activeId
            : valid[0].id;
        return { ...current, tabs: valid, activeId };
      },
    },
  ),
);
