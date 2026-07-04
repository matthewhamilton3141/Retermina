/**
 * Pure collision resolution for panel drops on the workspace grid.
 *
 * Extracted from WorkspaceLayout so the drop logic is unit-testable and the
 * component only wires RGL callbacks to it. Everything operates on plain
 * rects in grid units; react-grid-layout's LayoutItem satisfies GridRect
 * structurally, so callers can pass RGL layouts straight through.
 *
 * Resolution strategy, in order:
 *   1. Swap    — the drop lands squarely on one panel (its center is inside
 *                that panel's rect): the two panels trade rects wholesale.
 *                Both rects were valid pre-drag slots, so a swap can never
 *                introduce a new overlap.
 *   2. Resize  — shrink each displaced panel along the overlapping edge.
 *   3. Relocate — move the displaced panel to the drag origin.
 *   4. Abort   — if any step fails, or the resolved layout still contains an
 *                overlap (e.g. two displaced panels resolved onto each other),
 *                the drop is rejected and the caller restores the pre-drag
 *                layout, which is valid by construction.
 */
import { GRID_COLS, GRID_ROWS } from "./workspaceLayout";

/** The minimal rect shape resolveDrop needs. RGL's LayoutItem satisfies it. */
export interface GridRect {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export function rectsOverlap(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Clamp a rect's position so it lies fully inside the grid. */
export function clampToGrid<T extends GridRect>(item: T): T {
  return {
    ...item,
    x: Math.max(0, Math.min(item.x, GRID_COLS - item.w)),
    y: Math.max(0, Math.min(item.y, GRID_ROWS - item.h)),
  };
}

function isInBounds(item: { w: number; h: number }, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x + item.w <= GRID_COLS && y + item.h <= GRID_ROWS;
}

/** Does `rect`'s size satisfy `item`'s min constraints? */
function fitsMin(rect: { w: number; h: number }, item: GridRect): boolean {
  return rect.w >= (item.minW ?? 1) && rect.h >= (item.minH ?? 1);
}

/** Every rect in bounds and no two rects overlapping. */
export function layoutIsValid(items: readonly GridRect[]): boolean {
  for (let a = 0; a < items.length; a++) {
    if (!isInBounds(items[a], items[a].x, items[a].y)) return false;
    for (let b = a + 1; b < items.length; b++) {
      if (rectsOverlap(items[a], items[b])) return false;
    }
  }
  return true;
}

/**
 * Try to shrink `displaced` so it no longer overlaps `priority`.
 * Generates one candidate per overlapping edge, returns the one that
 * preserves the most area, or null if every direction violates minW/minH.
 */
export function tryResizeToFit<T extends GridRect>(displaced: T, priority: GridRect): T | null {
  const minW = displaced.minW ?? 1;
  const minH = displaced.minH ?? 1;
  const candidates: T[] = [];

  if (displaced.x < priority.x && displaced.x + displaced.w > priority.x) {
    const newW = priority.x - displaced.x;
    if (newW >= minW) candidates.push({ ...displaced, w: newW });
  }
  if (
    displaced.x < priority.x + priority.w &&
    displaced.x + displaced.w > priority.x + priority.w
  ) {
    const newX = priority.x + priority.w;
    const newW = displaced.x + displaced.w - newX;
    if (newW >= minW && newX + newW <= GRID_COLS)
      candidates.push({ ...displaced, x: newX, w: newW });
  }
  if (displaced.y < priority.y && displaced.y + displaced.h > priority.y) {
    const newH = priority.y - displaced.y;
    if (newH >= minH) candidates.push({ ...displaced, h: newH });
  }
  if (
    displaced.y < priority.y + priority.h &&
    displaced.y + displaced.h > priority.y + priority.h
  ) {
    const newY = priority.y + priority.h;
    const newH = displaced.y + displaced.h - newY;
    if (newH >= minH && newY + newH <= GRID_ROWS)
      candidates.push({ ...displaced, y: newY, h: newH });
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (c.w * c.h > best.w * best.h ? c : best));
}

/**
 * Resolve a panel drop against the pre-drag layout.
 *
 * @param preDrag the full layout as it was when the drag started (valid).
 * @param oldItem the dragged panel's pre-drag rect.
 * @param newItem the dragged panel's dropped rect.
 * @returns the new layout, or null if the drop has no legal resolution and
 *          the caller should restore `preDrag` unchanged.
 *
 * The result is always built from `preDrag` (not RGL's post-drag layout):
 * with noCompactor, RGL's internal collision pass can shove bystanders to
 * arbitrary positions — only the dragged panel and explicitly resolved
 * panels should ever move.
 */
export function resolveDrop<T extends GridRect>(
  preDrag: readonly T[],
  oldItem: GridRect,
  newItem: GridRect,
): T[] | null {
  const dragged = preDrag.find((item) => item.i === newItem.i);
  if (!dragged) return null;

  const dropped = clampToGrid({ ...dragged, x: newItem.x, y: newItem.y, w: newItem.w, h: newItem.h });

  const displaced = preDrag.filter(
    (item) => item.i !== dropped.i && rectsOverlap(item, dropped),
  );

  // No collision — just move the dragged panel.
  if (displaced.length === 0) {
    return preDrag.map((item) => (item.i === dropped.i ? dropped : item));
  }

  // 1. Swap — drop center inside a single displaced panel, and each panel
  //    fits the other's slot.
  if (displaced.length === 1) {
    const target = displaced[0];
    const cx = dropped.x + dropped.w / 2;
    const cy = dropped.y + dropped.h / 2;
    const centerInTarget =
      cx >= target.x && cx < target.x + target.w && cy >= target.y && cy < target.y + target.h;
    if (centerInTarget && fitsMin(target, dragged) && fitsMin(oldItem, target)) {
      return preDrag.map((item) => {
        if (item.i === dragged.i)
          return { ...item, x: target.x, y: target.y, w: target.w, h: target.h };
        if (item.i === target.i)
          return { ...item, x: oldItem.x, y: oldItem.y, w: oldItem.w, h: oldItem.h };
        return item;
      });
    }
  }

  // 2./3. Resize each displaced panel, or relocate it to the drag origin.
  const resolutions = new Map<string, T>();
  for (const d of displaced) {
    const resized = tryResizeToFit(d, dropped);
    if (resized) {
      resolutions.set(d.i, clampToGrid(resized));
      continue;
    }
    if (isInBounds(d, oldItem.x, oldItem.y)) {
      resolutions.set(d.i, clampToGrid({ ...d, x: oldItem.x, y: oldItem.y }));
      continue;
    }
    return null;
  }

  // 4. Validate the whole tentative layout — catches displaced panels that
  //    resolved onto each other or onto an uninvolved bystander.
  const result = preDrag.map((item) => {
    if (item.i === dropped.i) return dropped;
    return resolutions.get(item.i) ?? item;
  });
  return layoutIsValid(result) ? result : null;
}
