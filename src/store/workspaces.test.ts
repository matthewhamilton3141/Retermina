// Store-level tests for the two behaviours added in 0.4.2:
//   1. Opening a real folder consumes an untouched placeholder blank terminal
//      instead of letting it ride along (and spawn a permission-hungry shell).
//   2. Focus mode is remembered per folder, so closing a tab and reopening the
//      folder restores whichever panel was maximized.
//   3. Claude is the default workspace surface, while an explicit Canvas choice
//      is remembered per folder.
//   4. The auxiliary tool drawer remembers its active panel and width per folder.
//
// The store persists through zustand's `persist` middleware, which reaches for
// `localStorage`; the unit-test runner is a plain node env, so shim a minimal
// in-memory store before importing anything that touches it.
import { beforeEach, describe, expect, it } from "vitest";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

const {
  MAX_WORKSPACE_SIDEBAR_WIDTH,
  useWorkspacesStore,
} = await import("./workspaces");
const {
  PANEL_IDS,
  createDefaultWorkspaceLayout,
  sanitizeGridItem,
} = await import("../lib/workspaceLayout");

type Tab = ReturnType<typeof useWorkspacesStore.getState>["tabs"][number];

/** A tab on the pristine default layout — the shape of an untouched blank. */
function pristineTab(id: string, cwd: string | null, focusedId?: string): Tab {
  const def = createDefaultWorkspaceLayout();
  return {
    id,
    cwd,
    title: cwd ?? "Blank Terminal",
    mode: "claude",
    panels: def.panels,
    grid: def.grid.map(sanitizeGridItem),
    panelFontSizes: {},
    ...(focusedId ? { focusedId } : {}),
  };
}

function reset(tabs: Tab[], activeId: string | null) {
  useWorkspacesStore.setState({ tabs, activeId, folderLayouts: {}, layoutTemplate: null });
}

describe("openWorkspace — placeholder blank consumption", () => {
  beforeEach(() => reset([], null));

  it("replaces an untouched blank tab when opening a real folder", () => {
    reset([pristineTab("blank", null)], "blank");
    const id = useWorkspacesStore.getState().openWorkspace("/proj");
    const { tabs } = useWorkspacesStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe(id);
    expect(tabs[0].cwd).toBe("/proj");
  });

  it("keeps a blank tab the user has customized (resized layout)", () => {
    const blank = pristineTab("blank", null);
    blank.grid = blank.grid.map((g) => ({ ...g, w: g.w + 1 })); // no longer pristine
    reset([blank], "blank");
    useWorkspacesStore.getState().openWorkspace("/proj");
    const cwds = useWorkspacesStore.getState().tabs.map((t) => t.cwd);
    expect(cwds).toHaveLength(2);
    expect(cwds).toContain(null);
    expect(cwds).toContain("/proj");
  });

  it("still reuses an existing folder tab rather than duplicating it", () => {
    reset([pristineTab("p1", "/proj")], "p1");
    const id = useWorkspacesStore.getState().openWorkspace("/proj");
    expect(id).toBe("p1");
    expect(useWorkspacesStore.getState().tabs).toHaveLength(1);
  });
});

describe("focus mode — restore across close + reopen", () => {
  beforeEach(() => reset([], null));

  it("remembers the focused panel and restores it when the folder reopens", () => {
    const focused = createDefaultWorkspaceLayout().panels[0].id;
    reset([pristineTab("p1", "/proj", focused)], "p1");

    useWorkspacesStore.getState().closeWorkspace("p1");
    expect(useWorkspacesStore.getState().folderLayouts["/proj"]?.focusedId).toBe(focused);

    useWorkspacesStore.getState().openWorkspace("/proj");
    const reopened = useWorkspacesStore.getState().tabs.find((t) => t.cwd === "/proj");
    expect(reopened?.focusedId).toBe(focused);
  });

  it("drops a remembered focus that no longer names a live panel", () => {
    reset([pristineTab("p1", "/proj", "ghost-panel")], "p1");
    useWorkspacesStore.getState().closeWorkspace("p1");
    useWorkspacesStore.getState().openWorkspace("/proj");
    const reopened = useWorkspacesStore.getState().tabs.find((t) => t.cwd === "/proj");
    expect(reopened?.focusedId ?? null).toBeNull();
  });
});

describe("workspace surface", () => {
  beforeEach(() => reset([], null));

  it("starts Claude-first and remembers an explicit Canvas switch per folder", () => {
    const id = useWorkspacesStore.getState().openWorkspace("/proj");
    expect(useWorkspacesStore.getState().tabs[0]?.mode).toBe("claude");

    useWorkspacesStore.getState().setMode(id, "canvas");
    useWorkspacesStore.getState().closeWorkspace(id);
    useWorkspacesStore.getState().openWorkspace("/proj");

    expect(useWorkspacesStore.getState().tabs[0]?.mode).toBe("canvas");
  });

  it("remembers the active sidebar tool and its width per folder", () => {
    const id = useWorkspacesStore.getState().openWorkspace("/proj");
    const panelId = useWorkspacesStore.getState().tabs[0].panels[0].id;
    useWorkspacesStore.getState().setSidebarPanel(id, panelId);
    useWorkspacesStore.getState().setSidebarWidth(id, 512);

    useWorkspacesStore.getState().closeWorkspace(id);
    useWorkspacesStore.getState().openWorkspace("/proj");

    expect(useWorkspacesStore.getState().tabs[0]).toMatchObject({
      sidebarPanelId: panelId,
      sidebarWidth: 512,
    });
  });

  it("clears a sidebar tool when that panel closes and clamps its width", () => {
    const id = useWorkspacesStore.getState().openWorkspace("/proj");
    const panelId = useWorkspacesStore.getState().tabs[0].panels[0].id;
    useWorkspacesStore.getState().setSidebarPanel(id, panelId);
    useWorkspacesStore.getState().setSidebarWidth(id, 10_000);
    useWorkspacesStore.getState().closePanel(id, panelId);

    expect(useWorkspacesStore.getState().tabs[0]).toMatchObject({
      sidebarPanelId: null,
      sidebarWidth: MAX_WORKSPACE_SIDEBAR_WIDTH,
    });
  });

  it("folds legacy Explorer layouts into the integrated editor", () => {
    const id = useWorkspacesStore.getState().openWorkspace("/proj");
    useWorkspacesStore.getState().loadLayout(
      id,
      [
        {
          id: PANEL_IDS.fileExplorer,
          kind: "fileExplorer",
          title: "Explorer",
        },
      ],
      [
        {
          i: PANEL_IDS.fileExplorer,
          x: 0,
          y: 0,
          w: 3,
          h: 10,
        },
      ],
    );

    expect(useWorkspacesStore.getState().tabs[0].panels).toEqual([
      {
        id: PANEL_IDS.codeView,
        kind: "codeView",
        title: "Editor",
      },
    ]);
    expect(useWorkspacesStore.getState().tabs[0].grid[0]).toMatchObject({
      i: PANEL_IDS.codeView,
      minW: 5,
    });
  });
});
