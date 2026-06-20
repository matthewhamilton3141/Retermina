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
export type PanelKind =
  | "terminal"
  | "fileExplorer"
  | "localhost"
  | "codeView"
  | "claudeCode"
  | "livePreview";

/** Every supported panel kind, in default display order. */
export const PANEL_KINDS: readonly PanelKind[] = [
  "fileExplorer",
  "terminal",
  "codeView",
  "localhost",
  "claudeCode",
  "livePreview",
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
  codeView: "code-view",
  claudeCode: "claude-code",
  livePreview: "live-preview",
};

/** Icon + label for each panel kind. Single source of truth for chrome text. */
export const PANEL_META: Record<PanelKind, PanelMeta> = {
  terminal: { icon: "terminal", label: "Terminal" },
  fileExplorer: { icon: "explorer", label: "Explorer" },
  localhost: { icon: "localhost", label: "Localhost" },
  codeView: { icon: "code", label: "Code" },
  claudeCode: { icon: "bot", label: "Claude Code" },
  livePreview: { icon: "preview", label: "Preview" },
};

/**
 * Default size used when a panel is (re)added via the toolbar toggle.
 *
 * Sizes are intentionally modest so a re-added panel always fits on screen
 * without pushing other panels out of view. The user can resize from there.
 *
 * None of these leave a panel flush against GRID_COLS/GRID_ROWS on a growable
 * edge — react-grid-layout clamps resize growth at the grid boundary with no
 * visual "you're maxed out" feedback, so a panel pinned flush to an edge reads
 * as "resizing doesn't work" in that direction. Leaving at least one column/row
 * of slack keeps every panel actually resizable both wider/taller and
 * narrower/shorter from its default size.
 */
export const DEFAULT_PANEL_SIZE: Record<
  PanelKind,
  Required<Pick<WorkspaceGridItem, "w" | "h" | "minW" | "minH">>
> = {
  //           w   h   minW  minH
  terminal:    { w: 8, h: 5, minW: 3, minH: 2 },
  fileExplorer:{ w: 3, h: 5, minW: 2, minH: 2 },
  codeView:    { w: 8, h: 4, minW: 3, minH: 2 },
  localhost:   { w: 3, h: 4, minW: 2, minH: 2 },
  // A real working terminal pane, not a cramped sidebar strip, sized to dock
  // comfortably alongside Terminal, Code View, or Localhost. The default
  // 4-panel layout fully tiles the grid (by design — see the resize-cap note
  // above), so toggling on a 5th panel of any size lands via findFreeSlot's
  // overlap fallback at first; the user drags it into place once, same as
  // adding any other panel beyond the default four.
  claudeCode:  { w: 4, h: 4, minW: 3, minH: 2 },
  // Live Preview needs reasonable height for the iframe to show content.
  livePreview: { w: 6, h: 6, minW: 3, minH: 3 },
};

/**
 * Panel kinds present on first launch. `claudeCode` is deliberately excluded:
 * it auto-runs the `claude` CLI as soon as its terminal connects (see the
 * panel's renderer in panels.tsx), and silently launching an external binary
 * the user may not have installed isn't something a default layout should do
 * unprompted. It still gets a toolbar toggle (PANEL_KINDS drives that), so
 * docking it is one click away — it's opt-in, not hidden.
 */
const DEFAULT_VISIBLE_PANEL_KINDS: readonly PanelKind[] = [
  "fileExplorer",
  "terminal",
  "codeView",
  "localhost",
];

/**
 * Default layout: a narrow rail on the left (Explorer on top, the more
 * lightweight Localhost tracker beneath it — both share Explorer's width
 * rather than spanning the full right side), with Terminal and the new Code
 * panel filling the wider right-hand area Localhost used to occupy.
 *
 * Columns: 3 (rail) + 8 (main) = 11 of 12 — one column of right-edge slack so
 * Terminal/Code can still grow wider via the `e`/`se` handles.
 * Rows: rail splits 5/5 of 10; main splits 5 (terminal) + 4 (code) of 9 rows,
 * leaving one row of bottom-edge slack on the main column too.
 */
export function createDefaultWorkspaceLayout(): WorkspaceLayout {
  return {
    version: WORKSPACE_LAYOUT_VERSION,
    panels: DEFAULT_VISIBLE_PANEL_KINDS.map((kind) => ({
      id: PANEL_IDS[kind],
      kind,
      title: PANEL_META[kind].label,
    })),
    grid: [
      // Left rail, top — file explorer
      { i: PANEL_IDS.fileExplorer, x: 0, y: 0, w: 3, h: 5, minW: 2, minH: 2 },
      // Left rail, bottom — localhost tracker (now the same width as Explorer)
      { i: PANEL_IDS.localhost,    x: 0, y: 5, w: 3, h: 4, minW: 2, minH: 2 },
      // Main column, top — terminal (the space Localhost used to occupy)
      { i: PANEL_IDS.terminal,     x: 3, y: 0, w: 8, h: 5, minW: 3, minH: 2 },
      // Main column, bottom — code view
      { i: PANEL_IDS.codeView,     x: 3, y: 5, w: 8, h: 4, minW: 3, minH: 2 },
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
