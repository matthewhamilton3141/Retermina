/**
 * Serializable workspace layout schema.
 *
 * Everything in this module is plain JSON so the entire workspace arrangement
 * (which panels are visible plus their grid coordinates and sizes) can be
 * persisted to disk and, in Step 7, exported/imported as a shareable preset.
 *
 * Coordinates and sizes are expressed in grid units, not pixels: the grid has
 * a fixed column count and the row height is derived at render time so the
 * layout scales with the window. That keeps a serialized layout meaningful on
 * any screen size.
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

/** Number of columns the grid snaps to (half-width = 6, quadrant-friendly). */
export const GRID_COLS = 12;
/** Target row count used to derive row height so the grid fills its host. */
export const GRID_ROWS = 12;
/** [horizontal, vertical] gap between panels, in pixels. */
export const GRID_MARGIN: readonly [number, number] = [10, 10];
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

/** Default size used when a panel is (re)added from the toolbar. */
export const DEFAULT_PANEL_SIZE: Record<
  PanelKind,
  Required<Pick<WorkspaceGridItem, "w" | "h" | "minW" | "minH">>
> = {
  terminal: { w: 6, h: 6, minW: 3, minH: 3 },
  fileExplorer: { w: 3, h: 8, minW: 2, minH: 4 },
  localhost: { w: 6, h: 4, minW: 3, minH: 2 },
};

/**
 * Build the default arrangement: a tall file-explorer rail on the left, a large
 * terminal filling the top-right, and the localhost tracker beneath it. Heights
 * sum to GRID_ROWS per column so the default fills the viewport without gaps.
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
      { i: PANEL_IDS.fileExplorer, x: 0, y: 0, w: 3, h: 12, minW: 2, minH: 4 },
      { i: PANEL_IDS.terminal, x: 3, y: 0, w: 9, h: 8, minW: 3, minH: 3 },
      { i: PANEL_IDS.localhost, x: 3, y: 8, w: 9, h: 4, minW: 3, minH: 2 },
    ],
  };
}

/** Lowest free row beneath all current items (so re-added panels don't overlap). */
export function nextFreeRow(grid: readonly WorkspaceGridItem[]): number {
  return grid.reduce((max, item) => Math.max(max, item.y + item.h), 0);
}

/**
 * Strip a grid item down to its serializable fields. react-grid-layout enriches
 * its internal items with bookkeeping flags (`moved`, `static`, ...); this keeps
 * persisted/exported JSON limited to the schema above.
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
 * item gets a freshly synthesized default-sized slot. The result always has
 * exactly one grid item per visible panel, so an external preset can never
 * desync the two arrays.
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

  const panelIds = new Set(cleanPanels.map((panel) => panel.id));

  // Keep at most one sanitized grid item per existing panel.
  const placed = new Set<string>();
  const cleanGrid: WorkspaceGridItem[] = [];
  for (const item of grid) {
    if (!panelIds.has(item.i) || placed.has(item.i)) continue;
    placed.add(item.i);
    cleanGrid.push(sanitizeGridItem(item));
  }

  // Synthesize a slot for any panel that lacks one (mirrors togglePanel sizing).
  for (const panel of cleanPanels) {
    if (placed.has(panel.id)) continue;
    const size = DEFAULT_PANEL_SIZE[panel.kind];
    cleanGrid.push({
      i: panel.id,
      x: 0,
      y: nextFreeRow(cleanGrid),
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
