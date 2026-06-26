import { describe, it, expect } from "vitest";
import {
  sanitizeGridItem,
  reconcileWorkspaceLayout,
  fitIntoColumn,
  isWorkspacePanelArray,
  isWorkspaceGridArray,
  PANEL_COLUMN,
  GRID_ROWS,
  type WorkspacePanel,
  type WorkspaceGridItem,
} from "./workspaceLayout";

describe("sanitizeGridItem", () => {
  it("keeps only the serializable fields and drops RGL bookkeeping", () => {
    const dirty = {
      i: "p1",
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      minW: 2,
      minH: 2,
      moved: true,
      static: false,
      isDraggable: true,
    } as unknown as WorkspaceGridItem;
    expect(sanitizeGridItem(dirty)).toEqual({ i: "p1", x: 1, y: 2, w: 3, h: 4, minW: 2, minH: 2 });
  });

  it("omits min constraints when they are not numbers", () => {
    const item = { i: "p1", x: 0, y: 0, w: 4, h: 4 } as WorkspaceGridItem;
    const clean = sanitizeGridItem(item);
    expect("minW" in clean).toBe(false);
    expect("minH" in clean).toBe(false);
  });
});

describe("type guards", () => {
  it("isWorkspacePanelArray accepts valid panels and rejects bad kinds", () => {
    expect(isWorkspacePanelArray([{ id: "a", kind: "terminal", title: "T" }])).toBe(true);
    expect(isWorkspacePanelArray([{ id: "a", kind: "not-a-kind", title: "T" }])).toBe(false);
    expect(isWorkspacePanelArray([{ id: "a", title: "T" }])).toBe(false);
    expect(isWorkspacePanelArray("nope")).toBe(false);
  });

  it("isWorkspaceGridArray requires the geometry fields", () => {
    expect(isWorkspaceGridArray([{ i: "a", x: 0, y: 0, w: 4, h: 4 }])).toBe(true);
    expect(isWorkspaceGridArray([{ i: "a", x: 0, y: 0, w: 4 }])).toBe(false);
    expect(isWorkspaceGridArray([{ x: 0, y: 0, w: 4, h: 4 }])).toBe(false);
    expect(isWorkspaceGridArray(null)).toBe(false);
  });
});

describe("reconcileWorkspaceLayout", () => {
  it("dedupes panels, drops orphan grid items, and synthesizes missing slots", () => {
    const panels: WorkspacePanel[] = [
      { id: "a", kind: "terminal", title: "T" },
      { id: "a", kind: "terminal", title: "T (dup)" },
      { id: "b", kind: "codeView", title: "C" },
    ];
    const grid: WorkspaceGridItem[] = [
      { i: "a", x: 0, y: 0, w: 4, h: 5 },
      { i: "ghost", x: 0, y: 0, w: 1, h: 1 }, // references no panel
    ];

    const out = reconcileWorkspaceLayout(panels, grid);

    expect(out.panels.map((p) => p.id)).toEqual(["a", "b"]);
    // ghost dropped; "a" kept; "b" synthesized.
    expect(out.grid.map((g) => g.i).sort()).toEqual(["a", "b"]);
    expect(out.grid.some((g) => g.i === "ghost")).toBe(false);
    // Every grid item maps to a real panel.
    const panelIds = new Set(out.panels.map((p) => p.id));
    expect(out.grid.every((g) => panelIds.has(g.i))).toBe(true);
  });
});

describe("fitIntoColumn", () => {
  it("places a new panel in its kind's preferred column", () => {
    const out = fitIntoColumn([], "term-1", "terminal");
    const item = out.find((g) => g.i === "term-1")!;
    expect(item.x).toBe(PANEL_COLUMN.terminal.x);
    expect(item.w).toBe(PANEL_COLUMN.terminal.w);
  });

  it("stacks panels in the same column so they share the grid height", () => {
    const first = fitIntoColumn([], "term-1", "terminal");
    const out = fitIntoColumn(first, "term-2", "terminal");
    const col = out.filter((g) => g.x === PANEL_COLUMN.terminal.x);
    expect(col.length).toBe(2);
    // Stacked top-to-bottom, filling the column without exceeding it.
    const bottom = Math.max(...col.map((g) => g.y + g.h));
    expect(bottom).toBeLessThanOrEqual(GRID_ROWS);
    expect(col.every((g) => g.w === PANEL_COLUMN.terminal.w)).toBe(true);
  });
});
