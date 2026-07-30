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
import { closePty } from "../lib/pty";
import { useToastStore } from "./toast";
import { ptySessionKey, usePtySessionsStore } from "./ptySessions";
import { rectsOverlap } from "../lib/gridCollision";
import {
  DEFAULT_PANEL_SIZE,
  GRID_COLS,
  GRID_ROWS,
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

export type WorkspaceMode = "claude" | "canvas";

export const DEFAULT_WORKSPACE_SIDEBAR_WIDTH = 360;
export const EDITOR_WORKSPACE_SIDEBAR_WIDTH = 760;
export const MIN_WORKSPACE_SIDEBAR_WIDTH = 280;
export const MAX_WORKSPACE_SIDEBAR_WIDTH = 1040;

export interface WorkspaceTab {
  id: string;
  cwd: string | null;
  title: string;
  /** Claude is the primary surface; Canvas exposes the auxiliary panel grid. */
  mode: WorkspaceMode;
  panels: WorkspacePanel[];
  grid: WorkspaceGridItem[];
  /** Per-panel font size as a percentage (70–150, default 100). */
  panelFontSizes: Record<string, number>;
  /** Auxiliary panel currently open beside Claude, or null for a rail-only view. */
  sidebarPanelId?: string | null;
  /** Width of the Cursor-style auxiliary panel drawer. */
  sidebarWidth?: number;
  /**
   * Id of the panel currently maximized into focus mode, or null/undefined for
   * none. Persisted per tab so reopening the app restores whichever panel was
   * focused when it closed. Optional because tabs persisted before this field
   * existed lack it.
   */
  focusedId?: string | null;
  /**
   * Grid rects of panels that were hidden/closed, keyed by panel id. When a
   * panel is toggled back on it returns to its remembered spot — if that spot
   * is still free — instead of being re-placed from scratch. Optional because
   * tabs persisted before this field existed lack it.
   */
  closedSlots?: Record<string, WorkspaceGridItem>;
}

/**
 * The layout new tabs are born with. Set whenever the user applies a preset
 * (workspace preset or Loom), so an applied preset follows them across
 * newly opened / reopened workspaces instead of snapping back to the default
 * grid. Null → `createDefaultWorkspaceLayout()`.
 */
export interface WorkspaceLayoutTemplate {
  panels: WorkspacePanel[];
  grid: WorkspaceGridItem[];
  panelFontSizes: Record<string, number>;
}

/** A remembered per-folder layout, stamped so the map can evict oldest-first. */
interface FolderLayout extends WorkspaceLayoutTemplate {
  updatedAt: number;
  /** Reopen a folder in the surface it was using when closed. */
  mode?: WorkspaceMode;
  sidebarPanelId?: string | null;
  sidebarWidth?: number;
  /**
   * Which panel was maximized into focus mode when the folder's tab closed, so
   * reopening the folder restores focus too (not just the tiled arrangement).
   */
  focusedId?: string | null;
}

/** How many closed folders' layouts we remember before evicting the oldest. */
const FOLDER_LAYOUTS_CAP = 30;

interface WorkspacesState {
  tabs: WorkspaceTab[];
  activeId: string | null;
  /** Layout template applied to freshly created tabs (see {@link WorkspaceLayoutTemplate}). */
  layoutTemplate: WorkspaceLayoutTemplate | null;
  /**
   * Last-known layout per folder (keyed by cwd), snapshotted when its tab
   * closes, so reopening a project restores how *that* project was arranged.
   * Wins over `layoutTemplate` for folders we've seen before; cleared whenever
   * a preset is applied so a fresh preset takes effect everywhere.
   */
  folderLayouts: Record<string, FolderLayout>;

  // ── Tab management ────────────────────────────────────────────────────────
  /** Activate the tab matching `cwd`, or create one if none exists. Returns its id. */
  openWorkspace: (cwd?: string | null) => string;
  /** Always create a fresh tab (used by the "+" new-tab button). Returns its id. */
  newWorkspace: (cwd?: string | null) => string;
  /**
   * Id of the tab whose close is awaiting confirmation, or null. Transient —
   * never persisted. Both the tab close button and the ⌘W shortcut set this so
   * every close path goes through the same confirmation dialog.
   */
  pendingCloseId: string | null;
  /** Ask to close a tab; surfaces the confirmation dialog. No-op if unknown. */
  requestCloseWorkspace: (id: string) => void;
  /** Dismiss the close-confirmation prompt without closing anything. */
  cancelCloseWorkspace: () => void;
  closeWorkspace: (id: string) => void;
  setActive: (id: string) => void;
  setMode: (id: string, mode: WorkspaceMode) => void;
  setSidebarPanel: (id: string, panelId: string | null) => void;
  setSidebarWidth: (id: string, width: number) => void;
  /** Reorder: move the tab `fromId` to the current position of `toId`. */
  moveTab: (fromId: string, toId: string) => void;

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
  /** Set (or clear, with null) which panel is maximized into focus mode. */
  setFocusedPanel: (id: string, panelId: string | null) => void;
  /** Append a fresh terminal panel to a free grid slot. Used by split pop-out. */
  addTerminalPanel: (id: string) => void;
  /** Remember (or clear) the layout that newly created tabs should start from. */
  setLayoutTemplate: (template: WorkspaceLayoutTemplate | null) => void;
}

interface PersistedWorkspacesState {
  tabs: Array<
    WorkspaceTab & {
      sidebarPanelId: string | null;
      sidebarWidth: number;
      closedSlots: Record<string, WorkspaceGridItem>;
      focusedId: string | null;
    }
  >;
  activeId: string | null;
  layoutTemplate: WorkspaceLayoutTemplate | null;
  folderLayouts: Record<string, FolderLayout>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const newId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

const titleFor = (cwd: string | null) => (cwd ? prettyPath(cwd) : "Blank Terminal");

const clampSidebarWidth = (width: number) =>
  Math.round(
    Math.max(
      MIN_WORKSPACE_SIDEBAR_WIDTH,
      Math.min(MAX_WORKSPACE_SIDEBAR_WIDTH, width),
    ),
  );

function makeTab(cwd: string | null, template?: WorkspaceLayoutTemplate | null): WorkspaceTab {
  // Clone the template so tabs never share panel/grid object identity.
  const layout = template
    ? structuredClone(template)
    : { ...createDefaultWorkspaceLayout(), panelFontSizes: {} };
  const integrated = integrateExplorerIntoEditor(layout.panels, layout.grid);
  return {
    id: newId(),
    cwd,
    title: titleFor(cwd),
    mode: "claude",
    panels: integrated.panels,
    grid: integrated.grid.map(sanitizeGridItem),
    panelFontSizes: layout.panelFontSizes,
    sidebarPanelId: null,
    sidebarWidth: DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
  };
}

/**
 * Explorer is now editor chrome, not a standalone workspace panel. This keeps
 * old presets and persisted layouts usable while preventing duplicate trees.
 */
function integrateExplorerIntoEditor(
  panels: readonly WorkspacePanel[],
  grid: readonly WorkspaceGridItem[],
): { panels: WorkspacePanel[]; grid: WorkspaceGridItem[] } {
  const explorers = panels.filter((panel) => panel.kind === "fileExplorer");
  if (explorers.length === 0) {
    return { panels: [...panels], grid: [...grid] };
  }

  const explorerIds = new Set(explorers.map((panel) => panel.id));
  const existingEditor = panels.find((panel) => panel.kind === "codeView");
  const nextPanels = panels.filter((panel) => panel.kind !== "fileExplorer");
  const nextGrid = grid.filter((item) => !explorerIds.has(item.i));
  if (existingEditor) return { panels: nextPanels, grid: nextGrid };

  const source = grid.find((item) => explorerIds.has(item.i));
  const size = DEFAULT_PANEL_SIZE.codeView;
  nextPanels.push({
    id: PANEL_IDS.codeView,
    kind: "codeView",
    title: PANEL_META.codeView.label,
  });
  nextGrid.push(
    source
      ? {
          ...source,
          i: PANEL_IDS.codeView,
          w: Math.max(source.w, size.minW),
          h: Math.max(source.h, size.minH),
          minW: size.minW,
          minH: size.minH,
        }
      : {
          i: PANEL_IDS.codeView,
          x: 0,
          y: 0,
          w: size.w,
          h: size.h,
          minW: size.minW,
          minH: size.minH,
        },
  );
  return { panels: nextPanels, grid: nextGrid };
}

/**
 * Is `tab` an untouched placeholder blank terminal — a null-cwd tab still on the
 * pristine default layout, with no focus/font/closed-slot state? Such a tab was
 * never really used; opening a real folder consumes it instead of leaving it to
 * ride along, mount, and spawn a shell that demands broad folder permissions.
 */
function isDisposableBlank(tab: WorkspaceTab): boolean {
  if (tab.cwd !== null) return false;
  if (tab.mode !== "claude") return false;
  if (tab.sidebarPanelId) return false;
  if (tab.focusedId) return false;
  if (tab.closedSlots && Object.keys(tab.closedSlots).length > 0) return false;
  if (tab.panelFontSizes && Object.keys(tab.panelFontSizes).length > 0) return false;
  const def = createDefaultWorkspaceLayout();
  const samePanels =
    tab.panels.length === def.panels.length &&
    def.panels.every((p, i) => tab.panels[i]?.id === p.id && tab.panels[i]?.kind === p.kind);
  const sameGrid =
    tab.grid.length === def.grid.length &&
    def.grid.every((g) => {
      const cur = tab.grid.find((x) => x.i === g.i);
      return !!cur && cur.x === g.x && cur.y === g.y && cur.w === g.w && cur.h === g.h;
    });
  return samePanels && sameGrid;
}

/** Immutably replace the tab with `id`, applying `fn` to it. */
function patch(
  tabs: WorkspaceTab[],
  id: string,
  fn: (tab: WorkspaceTab) => WorkspaceTab,
): WorkspaceTab[] {
  return tabs.map((tab) => (tab.id === id ? fn(tab) : tab));
}

/**
 * Intentional close of a terminal panel: kill the survivable PTY the panel owns
 * so it does NOT resurrect on reopen, and drop its session mapping. No-op for a
 * panel with no live session on file. This is the opposite of detach-on-quit,
 * where we deliberately leave the shell running for the host's grace window.
 */
function killTerminalSession(tabId: string, panelId: string) {
  const key = ptySessionKey(tabId, panelId);
  const sessionId = usePtySessionsStore.getState().lookup(key);
  if (sessionId) void closePty(sessionId);
  usePtySessionsStore.getState().forget(key);
}

/** Kill every terminal session bound to a tab (whole-tab close). */
function killTabTerminalSessions(tab: WorkspaceTab) {
  for (const panel of tab.panels) {
    if (panel.kind === "terminal") killTerminalSession(tab.id, panel.id);
  }
  usePtySessionsStore.getState().forgetTab(tab.id);
}

/** Remember a hidden/closed panel's rect so a re-toggle can restore it. */
function rememberSlot(
  tab: WorkspaceTab,
  panelId: string,
): Record<string, WorkspaceGridItem> {
  const item = tab.grid.find((g) => g.i === panelId);
  if (!item) return tab.closedSlots ?? {};
  return { ...tab.closedSlots, [panelId]: sanitizeGridItem(item) };
}

/** Is `slot` fully on the grid and clear of every current panel? */
function slotIsFree(grid: readonly WorkspaceGridItem[], slot: WorkspaceGridItem): boolean {
  return (
    slot.x >= 0 &&
    slot.y >= 0 &&
    slot.x + slot.w <= GRID_COLS &&
    slot.y + slot.h <= GRID_ROWS &&
    !grid.some((item) => rectsOverlap(item, slot))
  );
}

/** Toggle a built-in singleton panel within one tab's layout. */
function togglePanelInTab(
  tab: WorkspaceTab,
): (kind: PanelKind) => Pick<WorkspaceTab, "panels" | "grid" | "closedSlots"> {
  return (kind) => {
    const id = PANEL_IDS[kind];
    const isVisible = tab.panels.some((p) => p.id === id);

    if (isVisible) {
      return {
        panels: tab.panels.filter((p) => p.id !== id),
        grid: tab.grid.filter((item) => item.i !== id),
        closedSlots: rememberSlot(tab, id),
      };
    }

    const panels = [...tab.panels, { id, kind, title: PANEL_META[kind].label }];
    const closedSlots = { ...tab.closedSlots };

    // Showing, in order of preference:
    //   1. The panel's remembered slot, if it's still free.
    //   2. Any genuinely free slot at the panel's default size.
    //   3. Share the panel's natural column (occupants shrink to make room).
    const remembered = closedSlots[id];
    delete closedSlots[id];
    if (remembered && slotIsFree(tab.grid, remembered)) {
      return { panels, grid: [...tab.grid, { ...remembered, i: id }], closedSlots };
    }

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

    return { panels, grid, closedSlots };
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
            mode: "claude",
            panels,
            grid: grid.map(sanitizeGridItem),
            panelFontSizes: {},
          },
        ];
      }
    }
  } catch {
    // Corrupt/absent legacy state — fall through to no tabs.
  }
  // No auto-created blank tab: a fresh launch sits on the Launch Hub with zero
  // tabs (which the workspace view already treats as "return to the hub"), so
  // nothing spawns a shell until the user actually opens a folder or explicitly
  // launches a blank terminal.
  return [];
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const WORKSPACES_VERSION = 3;

export const useWorkspacesStore = create<WorkspacesState>()(
  persist(
    (set, get) => {
      const initialTabs = seedTabs();
      return {
        tabs: initialTabs,
        activeId: initialTabs[0]?.id ?? null,
        layoutTemplate: null,
        folderLayouts: {},

        openWorkspace: (cwd = null) => {
          const existing = get().tabs.find((t) => t.cwd === cwd);
          if (existing) {
            set({ activeId: existing.id });
            return existing.id;
          }
          // A folder we've arranged before reopens the way we left it;
          // otherwise fall back to the applied preset, then the default grid.
          const remembered = cwd ? get().folderLayouts[cwd] : undefined;
          const tab = makeTab(cwd, remembered ?? get().layoutTemplate);
          tab.mode = remembered?.mode ?? "claude";
          tab.sidebarPanelId =
            remembered?.sidebarPanelId &&
            tab.panels.some((panel) => panel.id === remembered.sidebarPanelId)
              ? remembered.sidebarPanelId
              : null;
          tab.sidebarWidth = clampSidebarWidth(
            remembered?.sidebarWidth ?? DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
          );
          // Restore focus mode where the folder was left, if it names a live panel.
          if (remembered?.focusedId && tab.panels.some((p) => p.id === remembered.focusedId)) {
            tab.focusedId = remembered.focusedId;
          }
          set((s) => {
            // Opening a real folder consumes any untouched placeholder blank
            // terminal so it doesn't linger and demand folder permissions.
            const base = cwd ? s.tabs.filter((t) => !isDisposableBlank(t)) : s.tabs;
            return { tabs: [...base, tab], activeId: tab.id };
          });
          return tab.id;
        },

        newWorkspace: (cwd = null) => {
          const tab = makeTab(cwd, get().layoutTemplate);
          set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
          return tab.id;
        },

        pendingCloseId: null,

        requestCloseWorkspace: (id) => {
          if (get().tabs.some((t) => t.id === id)) set({ pendingCloseId: id });
        },

        cancelCloseWorkspace: () => set({ pendingCloseId: null }),

        closeWorkspace: (id) => {
          const state = get();
          const idx = state.tabs.findIndex((t) => t.id === id);
          if (idx === -1) return;
          const removed = state.tabs[idx];
          const prevActiveId = state.activeId;
          // Closing the only tab returns to the Launch Hub; offering Undo from
          // there would be confusing, so skip the toast in that case.
          const wasLast = state.tabs.length === 1;

          set((s) => {
            const tabs = s.tabs.filter((t) => t.id !== id);
            const pendingCloseId = s.pendingCloseId === id ? null : s.pendingCloseId;
            let activeId = s.activeId;
            if (s.activeId === id) {
              const neighbour = tabs[idx] ?? tabs[idx - 1] ?? tabs[0] ?? null;
              activeId = neighbour?.id ?? null;
            }
            // Remember how this folder was arranged so reopening it restores
            // the same layout. Capped: evict the oldest entries beyond the cap.
            let folderLayouts = s.folderLayouts;
            if (removed.cwd) {
              folderLayouts = {
                ...folderLayouts,
                [removed.cwd]: {
                  panels: removed.panels,
                  grid: removed.grid.map(sanitizeGridItem),
                  panelFontSizes: removed.panelFontSizes,
                  mode: removed.mode,
                  sidebarPanelId: removed.sidebarPanelId ?? null,
                  sidebarWidth: clampSidebarWidth(
                    removed.sidebarWidth ?? DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
                  ),
                  focusedId: removed.focusedId ?? null,
                  updatedAt: Date.now(),
                },
              };
              const keys = Object.keys(folderLayouts);
              if (keys.length > FOLDER_LAYOUTS_CAP) {
                for (const key of keys
                  .sort((a, b) => folderLayouts[a].updatedAt - folderLayouts[b].updatedAt)
                  .slice(0, keys.length - FOLDER_LAYOUTS_CAP)) {
                  const { [key]: _evicted, ...rest } = folderLayouts;
                  folderLayouts = rest;
                }
              }
            }
            return { tabs, activeId, folderLayouts, pendingCloseId };
          });

          // Intentional close → kill the tab's terminals so they don't
          // resurrect. (Undo restores the layout but starts fresh shells; the
          // live processes are gone — a deliberate close is treated as final.)
          killTabTerminalSessions(removed);

          if (!wasLast) {
            useToastStore.getState().push({
              message: `Closed “${removed.title}”`,
              action: {
                label: "Undo",
                onClick: () =>
                  set((s) => {
                    if (s.tabs.some((t) => t.id === removed.id)) return s;
                    const tabs = [...s.tabs];
                    tabs.splice(Math.min(idx, tabs.length), 0, removed);
                    return { tabs, activeId: prevActiveId ?? removed.id };
                  }),
              },
            });
          }
        },

        setActive: (id) => set({ activeId: id }),

        setMode: (id, mode) =>
          set((s) => ({ tabs: patch(s.tabs, id, (t) => ({ ...t, mode })) })),

        setSidebarPanel: (id, panelId) =>
          set((s) => ({
            tabs: patch(s.tabs, id, (t) => ({
              ...t,
              sidebarPanelId:
                panelId && t.panels.some((panel) => panel.id === panelId) ? panelId : null,
            })),
          })),

        setSidebarWidth: (id, width) =>
          set((s) => ({
            tabs: patch(s.tabs, id, (t) => ({
              ...t,
              sidebarWidth: clampSidebarWidth(width),
            })),
          })),

        moveTab: (fromId, toId) =>
          set((s) => {
            const from = s.tabs.findIndex((t) => t.id === fromId);
            const to = s.tabs.findIndex((t) => t.id === toId);
            if (from === -1 || to === -1 || from === to) return s;
            const tabs = [...s.tabs];
            const [moved] = tabs.splice(from, 1);
            tabs.splice(to, 0, moved);
            return { tabs };
          }),

        setGrid: (id, grid) => set((s) => ({ tabs: patch(s.tabs, id, (t) => ({ ...t, grid })) })),

        togglePanel: (id, kind) => {
          // Toggling the terminal panel off destroys its PTY — kill the
          // survivable session so it doesn't reattach on reopen.
          if (kind === "terminal") {
            const tab = get().tabs.find((t) => t.id === id);
            if (tab?.panels.some((p) => p.id === PANEL_IDS.terminal)) {
              killTerminalSession(id, PANEL_IDS.terminal);
            }
          }
          set((s) => ({
            tabs: patch(s.tabs, id, (t) => {
              const targetKind = kind === "fileExplorer" ? "codeView" : kind;
              const next = { ...t, ...togglePanelInTab(t)(targetKind) };
              // Hiding the focused panel drops focus mode with it.
              if (t.focusedId && !next.panels.some((p) => p.id === t.focusedId)) {
                next.focusedId = null;
              }
              if (
                t.sidebarPanelId &&
                !next.panels.some((panel) => panel.id === t.sidebarPanelId)
              ) {
                next.sidebarPanelId = null;
              }
              return next;
            }),
          }));
        },

        closePanel: (id, panelId) => {
          // Closing a terminal panel destroys its PTY — kill the survivable
          // session so it doesn't reattach on reopen.
          const tab = get().tabs.find((t) => t.id === id);
          if (tab?.panels.find((p) => p.id === panelId)?.kind === "terminal") {
            killTerminalSession(id, panelId);
          }
          set((s) => ({
            tabs: patch(s.tabs, id, (t) => ({
              ...t,
              panels: t.panels.filter((p) => p.id !== panelId),
              grid: t.grid.filter((item) => item.i !== panelId),
              closedSlots: rememberSlot(t, panelId),
              focusedId: t.focusedId === panelId ? null : t.focusedId,
              sidebarPanelId: t.sidebarPanelId === panelId ? null : t.sidebarPanelId,
            })),
          }));
        },

        resetLayout: (id) => {
          const prev = get().tabs.find((t) => t.id === id);
          if (!prev) return;
          // Snapshot the arrangement so the toast can put it back verbatim.
          const snapshot = { panels: prev.panels, grid: prev.grid, panelFontSizes: prev.panelFontSizes };
          set((s) => ({
            tabs: patch(s.tabs, id, (t) => {
              const fresh = createDefaultWorkspaceLayout();
              // A reset is a fresh start — drop remembered slots and focus too.
              return {
                ...t,
                mode: "claude",
                panels: fresh.panels,
                grid: fresh.grid,
                closedSlots: {},
                focusedId: null,
                sidebarPanelId: null,
              };
            }),
          }));
          useToastStore.getState().push({
            message: "Layout reset",
            action: {
              label: "Undo",
              onClick: () => get().loadLayout(id, snapshot.panels, snapshot.grid, snapshot.panelFontSizes),
            },
          });
        },

        loadLayout: (id, panels, grid, panelFontSizes) =>
          set((s) => ({
            tabs: patch(s.tabs, id, (t) => {
              const integrated = integrateExplorerIntoEditor(panels, grid);
              return {
                ...t,
                panels: integrated.panels,
                grid: integrated.grid.map(sanitizeGridItem),
                panelFontSizes: panelFontSizes ?? t.panelFontSizes,
                // A preset/Loom replaces the arrangement — old slots/focus are moot.
                closedSlots: {},
                focusedId: null,
                sidebarPanelId: null,
              };
            }),
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

        setFocusedPanel: (id, panelId) =>
          set((s) => ({ tabs: patch(s.tabs, id, (t) => ({ ...t, focusedId: panelId })) })),

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

        setLayoutTemplate: (template) =>
          set((s) => {
            const integrated = template
              ? integrateExplorerIntoEditor(template.panels, template.grid)
              : null;
            return {
              layoutTemplate:
                template && integrated
                  ? {
                      panels: integrated.panels,
                      grid: integrated.grid.map(sanitizeGridItem),
                      panelFontSizes: template.panelFontSizes ?? {},
                    }
                  : null,
              // A freshly applied preset should win everywhere — drop remembered
              // per-folder layouts so reopened folders pick it up too.
              folderLayouts: template ? {} : s.folderLayouts,
            };
          }),
      };
    },
    {
      name: "retermina.workspaces",
      version: WORKSPACES_VERSION,
      migrate: (persisted, version) => {
        if (
          version >= 3 ||
          !persisted ||
          typeof persisted !== "object"
        ) {
          return persisted as PersistedWorkspacesState;
        }
        if (version >= 2) return persisted as PersistedWorkspacesState;
        const data = persisted as Partial<WorkspacesState>;
        const tabs = Array.isArray(data.tabs)
          ? data.tabs.map((tab) => ({
              ...tab,
              // Canvas used to be entered as a side effect of opening any tool.
              // Start the new sidebar model Claude-first once, without losing
              // the user's panels or grid arrangement.
              mode: "claude" as const,
              sidebarPanelId: null,
              sidebarWidth: DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
              closedSlots: tab.closedSlots ?? {},
              focusedId: tab.focusedId ?? null,
            }))
          : data.tabs;
        const folderLayouts =
          data.folderLayouts && typeof data.folderLayouts === "object"
            ? Object.fromEntries(
                Object.entries(data.folderLayouts).map(([cwd, layout]) => [
                  cwd,
                  {
                    ...layout,
                    mode: "claude" as const,
                    sidebarPanelId: null,
                    sidebarWidth: DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
                  },
                ]),
              )
            : data.folderLayouts;
        return { ...data, tabs, folderLayouts } as PersistedWorkspacesState;
      },
      partialize: (state) => ({
        tabs: state.tabs.map((t) => ({
          id: t.id,
          cwd: t.cwd,
          title: t.title,
          mode: t.mode,
          panels: t.panels,
          grid: t.grid.map(sanitizeGridItem),
          panelFontSizes: t.panelFontSizes,
          sidebarPanelId: t.sidebarPanelId ?? null,
          sidebarWidth: clampSidebarWidth(
            t.sidebarWidth ?? DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
          ),
          closedSlots: t.closedSlots ?? {},
          focusedId: t.focusedId ?? null,
        })),
        activeId: state.activeId,
        layoutTemplate: state.layoutTemplate,
        folderLayouts: state.folderLayouts,
      }),
      // Reject corrupt persisted state and fall back to a freshly seeded tab.
      merge: (persisted, current) => {
        const data = persisted as Partial<WorkspacesState> | undefined;
        const tabs = Array.isArray(data?.tabs) ? data!.tabs : [];
        const valid = tabs
          .filter(
            (t): t is WorkspaceTab =>
              !!t &&
              typeof t.id === "string" &&
              isWorkspacePanelArray(t.panels) &&
              isWorkspaceGridArray(t.grid),
          )
          // Normalize closedSlots: keep only well-formed rects (old persisted
          // tabs predate the field entirely).
          .map((t) => {
            const integrated = integrateExplorerIntoEditor(t.panels, t.grid);
            const slots: Record<string, WorkspaceGridItem> = {};
            if (t.closedSlots && typeof t.closedSlots === "object") {
              for (const [pid, slot] of Object.entries(t.closedSlots)) {
                if (isWorkspaceGridArray([slot])) slots[pid] = sanitizeGridItem(slot);
              }
            }
            // Keep a persisted focus only if it still names a live panel.
            const focusedId =
              typeof t.focusedId === "string" &&
              integrated.panels.some((p) => p.id === t.focusedId)
                ? t.focusedId
                : null;
            const mode: WorkspaceMode = t.mode === "canvas" ? "canvas" : "claude";
            const sidebarPanelId =
              typeof t.sidebarPanelId === "string" &&
              integrated.panels.some((panel) => panel.id === t.sidebarPanelId)
                ? t.sidebarPanelId
                : t.panels.some(
                      (panel) =>
                        panel.id === t.sidebarPanelId &&
                        panel.kind === "fileExplorer",
                    )
                  ? PANEL_IDS.codeView
                  : null;
            const sidebarWidth = clampSidebarWidth(
              typeof t.sidebarWidth === "number"
                ? t.sidebarWidth
                : DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
            );
            return {
              ...t,
              mode,
              panels: integrated.panels,
              grid: integrated.grid.map(sanitizeGridItem),
              sidebarPanelId,
              sidebarWidth,
              closedSlots: slots,
              focusedId,
            };
          });
        const template =
          data?.layoutTemplate &&
          isWorkspacePanelArray(data.layoutTemplate.panels) &&
          isWorkspaceGridArray(data.layoutTemplate.grid)
            ? {
                panels: data.layoutTemplate.panels,
                grid: data.layoutTemplate.grid.map(sanitizeGridItem),
                panelFontSizes:
                  data.layoutTemplate.panelFontSizes &&
                  typeof data.layoutTemplate.panelFontSizes === "object"
                    ? data.layoutTemplate.panelFontSizes
                    : {},
              }
            : null;
        const folderLayouts: Record<string, FolderLayout> = {};
        if (data?.folderLayouts && typeof data.folderLayouts === "object") {
          for (const [cwd, layout] of Object.entries(data.folderLayouts)) {
            if (
              layout &&
              isWorkspacePanelArray(layout.panels) &&
              isWorkspaceGridArray(layout.grid)
            ) {
              const integrated = integrateExplorerIntoEditor(
                layout.panels,
                layout.grid,
              );
              folderLayouts[cwd] = {
                panels: integrated.panels,
                grid: integrated.grid.map(sanitizeGridItem),
                panelFontSizes:
                  layout.panelFontSizes && typeof layout.panelFontSizes === "object"
                    ? layout.panelFontSizes
                    : {},
                focusedId:
                  typeof layout.focusedId === "string" &&
                  integrated.panels.some((p) => p.id === layout.focusedId)
                    ? layout.focusedId
                    : null,
                mode: layout.mode === "canvas" ? "canvas" : "claude",
                sidebarPanelId:
                  typeof layout.sidebarPanelId === "string" &&
                  integrated.panels.some((panel) => panel.id === layout.sidebarPanelId)
                    ? layout.sidebarPanelId
                    : layout.panels.some(
                          (panel) =>
                            panel.id === layout.sidebarPanelId &&
                            panel.kind === "fileExplorer",
                        )
                      ? PANEL_IDS.codeView
                    : null,
                sidebarWidth: clampSidebarWidth(
                  typeof layout.sidebarWidth === "number"
                    ? layout.sidebarWidth
                    : DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
                ),
                updatedAt: typeof layout.updatedAt === "number" ? layout.updatedAt : 0,
              };
            }
          }
        }
        if (valid.length === 0)
          return { ...current, layoutTemplate: template, folderLayouts };
        const activeId =
          typeof data?.activeId === "string" && valid.some((t) => t.id === data.activeId)
            ? data.activeId
            : valid[0].id;
        return { ...current, tabs: valid, activeId, layoutTemplate: template, folderLayouts };
      },
    },
  ),
);
