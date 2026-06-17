/**
 * Serializable workspace layout schema.
 *
 * Everything in this module is plain JSON so the entire workspace arrangement
 * (which panels are visible plus their grid coordinates and sizes) can be
 * persisted to disk and exported/imported as a shareable preset.
 *
 * Coordinates and sizes are in grid units, not pixels: the grid has a fixed
 * column count and the row height is derived at render time so the layout
 * scales with the window.
 */
import type { IconName } from "../components/Icon";

/** The kinds of widget the workspace can host. */
export type PanelKind = "terminal" | "fileExplorer" | "localhost";

/** Every supported panel kind, in default display order. */
export const PANEL_KINDS: readonly PanelKind[] = [
  "fileExplorer",
  "terminal",
  "localhost",
];

/** A visible panel instance. `id` doubles as the grid item key. */
export interface WorkspacePanel {
  id: string;
  kind: PanelKind;
  title: string;
}

/** Grid coordinates + size for one panel, in grid units (not pixels). */
export interface WorkspaceGridItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

/** The complete, serializable layout document. */
export interface WorkspaceLayout {
  version: number;
  panels: WorkspacePanel[];
  grid: WorkspaceGridItem[];
}

/** Static, render-free metadata for a panel kind (icon + display label). */
export interface PanelMeta {
  icon: IconName;
  label: string;
}

/** Current schema version; bump when the persisted shape changes. */
export const WORKSPACE_LAYOUT_VERSION = 1;

/**
 * Number of columns the grid snaps to.
 * 12 columns = flexible halves (6), thirds (4), quarters (3).
 */
export const GRID_COLS = 12;

/**
 * Target row count used to derive row height so the grid fills its host.
 * 10 rows gives each row ~10% of the container height — enough resolution
 * for fine placement without panels becoming micro-sized at minimum height.
 */
export const GRID_ROWS = 10;

/** [horizontal, vertical] gap between panels, in pixels. */
export const GRID_MARGIN: readonly [number, number] = [8, 8];

/** Smallest row height we will compute, to avoid degenerate sizes. */
export const MIN_ROW_HEIGHT = 24;

/** Stable ids for the built-in singleton panels. */
export const PANEL_IDS: Record<PanelKind, string> = {
  terminal: "terminal",
  fileExplorer: "file-explorer",
  localhost: "localhost",
};

/** Icon + label for each panel kind. Single source of truth for chrome text. */
export const PANEL_META: Record<PanelKind, PanelMeta> = {
  terminal: { icon: "terminal", label: "Terminal" },
  fileExplorer: { icon: "explorer", label: "Explorer" },
  localhost: { icon: "localhost", label: "Localhost" },
};

/**
 * Default size used when a panel is (re)added via the toolbar toggle.
 *
 * Sizes are intentionally modest so a re-added panel always fits on screen
 * without pushing other panels out of view. The user can resize from there.
 */
export const DEFAULT_PANEL_SIZE: Record<
  PanelKind,
  Required<Pick<WorkspaceGridItem, "w" | "h" | "minW" | "minH">>
> = {
  //           w   h   minW  minH
  terminal:    { w: 6, h: 5, minW: 3, minH: 2 },
  fileExplorer:{ w: 3, h: 6, minW: 2, minH: 2 },
  localhost:   { w: 5, h: 4, minW: 3, minH: 2 },
};

/**
 * Default layout: file-explorer rail on the left, terminal top-right,
 * localhost tracker bottom-right.
 *
 * Columns: 3 + 9 = 12  ✓
 * Rows:    terminal (6) + localhost (4) = 10  ✓  (fills GRID_ROWS exactly)
 *          fileExplorer spans all 10 rows on the left
 *
 * This means on first launch every panel is fully visible with no overflow.
 */
export function createDefaultWorkspaceLayout(): WorkspaceLayout {
  return {
    version: WORKSPACE_LAYOUT_VERSION,
    panels: PANEL_KINDS.map((kind) => ({
      id: PANEL_IDS[kind],
      kind,
      title: PANEL_META[kind].label,
    })),
    grid: [
      // Left rail — full height
      { i: PANEL_IDS.fileExplorer, x: 0, y: 0, w: 3, h: 10, minW: 2, minH: 2 },
      // Top-right — main work area
      { i: PANEL_IDS.terminal,     x: 3, y: 0, w: 9, h: 6,  minW: 3, minH: 2 },
      // Bottom-right — localhost tracker
      { i: PANEL_IDS.localhost,    x: 3, y: 6, w: 9, h: 4,  minW: 3, minH: 2 },
    ],
  };
}

/**
 * Find a good position for a newly toggled-on panel.
 *
 * Strategy: scan the grid for the first 4-wide gap in the top half of the
 * grid. If none is found, place at (0, 0) — the user can move it. We never
 * stack panels below the visible rows, which would make them unreachable.
 */
export function findFreeSlot(
  grid: readonly WorkspaceGridItem[],
  w: number,
  h: number,
): { x: number; y: number } {
  const maxY = Math.max(0, GRID_ROWS - h);

  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= GRID_COLS - w; x++) {
      const overlaps = grid.some(
        (item) =>
          x < item.x + item.w &&
          x + w > item.x &&
          y < item.y + item.h &&
          y + h > item.y,
      );
      if (!overlaps) return { x, y };
    }
  }

  // Fall back to top-left; the panel will overlap but is immediately movable.
  return { x: 0, y: 0 };
}

/** @deprecated Use findFreeSlot instead — nextFreeRow can place panels off-screen. */
export function nextFreeRow(grid: readonly WorkspaceGridItem[]): number {
  return grid.reduce((max, item) => Math.max(max, item.y + item.h), 0);
}

/**
 * Strip a grid item down to its serializable fields. react-grid-layout enriches
 * its internal items with bookkeeping flags (`moved`, `static`, …); this keeps
 * persisted/exported JSON clean.
 */
export function sanitizeGridItem(item: WorkspaceGridItem): WorkspaceGridItem {
  const clean: WorkspaceGridItem = {
    i: item.i,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
  };
  if (typeof item.minW === "number") clean.minW = item.minW;
  if (typeof item.minH === "number") clean.minH = item.minH;
  return clean;
}

/**
 * Make a (possibly hand-edited or imported) layout safe to render. Panels are
 * deduped by id; grid items that reference no panel are dropped and the rest
 * are stripped to the serializable schema; and any panel left without a grid
 * item gets a freshly synthesized default-sized slot.
 */
export function reconcileWorkspaceLayout(
  panels: readonly WorkspacePanel[],
  grid: readonly WorkspaceGridItem[],
): { panels: WorkspacePanel[]; grid: WorkspaceGridItem[] } {
  const seenPanel = new Set<string>();
  const cleanPanels: WorkspacePanel[] = [];
  for (const panel of panels) {
    if (seenPanel.has(panel.id)) continue;
    seenPanel.add(panel.id);
    cleanPanels.push({ id: panel.id, kind: panel.kind, title: panel.title });
  }

  const panelIds = new Set(cleanPanels.map((p) => p.id));

  const placed = new Set<string>();
  const cleanGrid: WorkspaceGridItem[] = [];
  for (const item of grid) {
    if (!panelIds.has(item.i) || placed.has(item.i)) continue;
    placed.add(item.i);
    cleanGrid.push(sanitizeGridItem(item));
  }

  for (const panel of cleanPanels) {
    if (placed.has(panel.id)) continue;
    const size = DEFAULT_PANEL_SIZE[panel.kind];
    const { x, y } = findFreeSlot(cleanGrid, size.w, size.h);
    cleanGrid.push({
      i: panel.id,
      x,
      y,
      w: Math.min(size.w, GRID_COLS),
      h: size.h,
      minW: size.minW,
      minH: size.minH,
    });
    placed.add(panel.id);
  }

  return { panels: cleanPanels, grid: cleanGrid };
}

function isPanelKind(value: unknown): value is PanelKind {
  return (
    typeof value === "string" &&
    (PANEL_KINDS as readonly string[]).includes(value)
  );
}

/** Runtime guard for a persisted panel array (rejects unknown kinds). */
export function isWorkspacePanelArray(value: unknown): value is WorkspacePanel[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const panel = entry as Record<string, unknown>;
      return (
        typeof panel.id === "string" &&
        isPanelKind(panel.kind) &&
        typeof panel.title === "string"
      );
    })
  );
}

/** Runtime guard for a persisted grid array. */
export function isWorkspaceGridArray(value: unknown): value is WorkspaceGridItem[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const item = entry as Record<string, unknown>;
      return (
        typeof item.i === "string" &&
        typeof item.x === "number" &&
        typeof item.y === "number" &&
        typeof item.w === "number" &&
        typeof item.h === "number"
      );
    })
  );
}