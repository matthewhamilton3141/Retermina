/**
 * WorkspaceLayout — the RGL-powered panel grid.
 *
 * react-grid-layout is the sole engine for panel positioning, drag, and
 * resize. The grid is fully controlled: layout state lives in the Zustand
 * workspace store and every change (drag, resize, toggle) flows back through
 * onLayoutChange → setGrid. noCompactor keeps panels static between
 * explicit user actions.
 *
 * During drag, RGL renders its own .react-grid-placeholder at the correct
 * drop position. No custom pixel-positioned overlay is needed or used.
 *
 * Collision resolution on drop lives in lib/gridCollision (resolveDrop):
 * swap → resize → relocate → abort, always validated against the whole
 * layout before committing.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import GridLayout, { noCompactor, type Layout, type LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import Icon from "../Icon";
import ClaudeCodePanel from "./ClaudeCodePanel";
import PanelFrame from "./PanelFrame";
import { PANEL_RENDERERS } from "./panels";
import ConfirmDialog from "../ConfirmDialog";
import {
  DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
  EDITOR_WORKSPACE_SIDEBAR_WIDTH,
  MAX_WORKSPACE_SIDEBAR_WIDTH,
  MIN_WORKSPACE_SIDEBAR_WIDTH,
  useWorkspacesStore,
  type WorkspaceMode,
} from "../../store/workspaces";
import { clampToGrid, resolveDrop } from "../../lib/gridCollision";
import {
  GRID_COLS,
  GRID_MARGIN,
  GRID_ROWS,
  MIN_ROW_HEIGHT,
  PANEL_IDS,
  PANEL_META,
  type PanelKind,
  type WorkspaceGridItem,
  type WorkspacePanel,
} from "../../lib/workspaceLayout";

/** Auxiliary panel kinds that own a live PTY session — closing one is destructive. */
const LIVE_SESSION_KINDS: ReadonlySet<PanelKind> = new Set(["terminal"]);
const AUXILIARY_PANEL_KINDS: readonly PanelKind[] = [
  "codeView",
  "terminal",
  "localhost",
  "livePreview",
  "gitDiff",
  "tasks",
];
const ACTIVITY_RAIL_WIDTH = 42;

export interface WorkspaceLayoutProps {
  /** The tab whose layout this grid renders. */
  workspaceId: string;
  cwd: string | null;
  /** Claude is the primary stage; Canvas shows the auxiliary panel grid. */
  mode: WorkspaceMode;
  /** Whether this tab is the foreground one (drives Iris bus ownership). */
  active: boolean;
}

const EMPTY_PANELS: WorkspacePanel[] = [];
const EMPTY_GRID: WorkspaceGridItem[] = [];

interface ElementSize {
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function useElementSize() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (w: number, h: number) =>
      setSize((prev) =>
        prev.width === w && prev.height === h ? prev : { width: w, height: h },
      );
    apply(el.clientWidth, el.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) apply(Math.round(rect.width), Math.round(rect.height));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, ...size };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorkspaceLayout({ workspaceId, cwd, mode, active }: WorkspaceLayoutProps) {
  const panels      = useWorkspacesStore((s) => s.tabs.find((t) => t.id === workspaceId)?.panels ?? EMPTY_PANELS);
  const grid        = useWorkspacesStore((s) => s.tabs.find((t) => t.id === workspaceId)?.grid ?? EMPTY_GRID);
  const focusedId   = useWorkspacesStore((s) => s.tabs.find((t) => t.id === workspaceId)?.focusedId ?? null);
  const sidebarPanelId = useWorkspacesStore(
    (s) => s.tabs.find((t) => t.id === workspaceId)?.sidebarPanelId ?? null,
  );
  const sidebarWidth = useWorkspacesStore(
    (s) =>
      s.tabs.find((t) => t.id === workspaceId)?.sidebarWidth ??
      DEFAULT_WORKSPACE_SIDEBAR_WIDTH,
  );
  const setGridRaw  = useWorkspacesStore((s) => s.setGrid);
  const closePanelRaw = useWorkspacesStore((s) => s.closePanel);
  const resetLayoutRaw = useWorkspacesStore((s) => s.resetLayout);
  const setFocusedRaw = useWorkspacesStore((s) => s.setFocusedPanel);
  const togglePanelRaw = useWorkspacesStore((s) => s.togglePanel);
  const setModeRaw = useWorkspacesStore((s) => s.setMode);
  const setSidebarPanelRaw = useWorkspacesStore((s) => s.setSidebarPanel);
  const setSidebarWidthRaw = useWorkspacesStore((s) => s.setSidebarWidth);

  // Claude owns the workspace stage and is intentionally no longer a grid
  // panel. Keep its legacy grid record intact for old presets while RGL edits
  // only the auxiliary panel records.
  const setGrid = useCallback(
    (nextAuxiliaryGrid: WorkspaceGridItem[]) => {
      const tab = useWorkspacesStore.getState().tabs.find((item) => item.id === workspaceId);
      if (!tab) return;
      const auxiliaryIds = new Set(
        tab.panels.filter((panel) => panel.kind !== "claudeCode").map((panel) => panel.id),
      );
      const reserved = tab.grid.filter((item) => !auxiliaryIds.has(item.i));
      setGridRaw(workspaceId, [...reserved, ...nextAuxiliaryGrid]);
    },
    [setGridRaw, workspaceId],
  );
  const closePanel = useCallback((id: string) => closePanelRaw(workspaceId, id), [closePanelRaw, workspaceId]);
  const setFocused = useCallback((id: string | null) => setFocusedRaw(workspaceId, id), [setFocusedRaw, workspaceId]);
  const setSidebarPanel = useCallback(
    (id: string | null) => setSidebarPanelRaw(workspaceId, id),
    [setSidebarPanelRaw, workspaceId],
  );
  const auxiliaryPanels = useMemo(
    () => panels.filter((panel) => panel.kind !== "claudeCode"),
    [panels],
  );
  const auxiliaryPanelIds = useMemo(
    () => new Set(auxiliaryPanels.map((panel) => panel.id)),
    [auxiliaryPanels],
  );
  const auxiliaryGrid = useMemo(
    () => grid.filter((item) => auxiliaryPanelIds.has(item.i)),
    [auxiliaryPanelIds, grid],
  );
  const activeSidebarPanel =
    auxiliaryPanels.find((panel) => panel.id === sidebarPanelId) ?? null;

  const toggleSidebarPanel = useCallback(
    (kind: PanelKind) => {
      const state = useWorkspacesStore.getState();
      const tab = state.tabs.find((item) => item.id === workspaceId);
      if (!tab) return;

      const existing = tab.panels.find((panel) => panel.kind === kind);
      const panelId = existing?.id ?? PANEL_IDS[kind];
      if (!existing) togglePanelRaw(workspaceId, kind);
      if (kind === "codeView") {
        setSidebarWidthRaw(
          workspaceId,
          Math.max(
            tab.sidebarWidth ?? EDITOR_WORKSPACE_SIDEBAR_WIDTH,
            EDITOR_WORKSPACE_SIDEBAR_WIDTH,
          ),
        );
      }

      setModeRaw(workspaceId, "claude");
      setSidebarPanelRaw(
        workspaceId,
        mode === "claude" && tab.sidebarPanelId === panelId ? null : panelId,
      );
    },
    [
      mode,
      setModeRaw,
      setSidebarPanelRaw,
      setSidebarWidthRaw,
      togglePanelRaw,
      workspaceId,
    ],
  );

  // Closing a Terminal tears down its live session, so it goes through a
  // confirmation first (like closing a workspace tab). Other auxiliary panels
  // close immediately. Claude itself is the persistent workspace stage.
  const [pendingClosePanelId, setPendingClosePanelId] = useState<string | null>(null);
  const requestClosePanel = useCallback(
    (id: string, kind: PanelKind) => {
      if (LIVE_SESSION_KINDS.has(kind)) setPendingClosePanelId(id);
      else closePanel(id);
    },
    [closePanel],
  );

  const { ref, width, height } = useElementSize();
  const mounted = width > 0 && height > 0;
  const editorSidebarActive = activeSidebarPanel?.kind === "codeView";
  const effectiveSidebarWidth = Math.min(
    sidebarWidth,
    Math.max(
      MIN_WORKSPACE_SIDEBAR_WIDTH,
      Math.floor(width * (editorSidebarActive ? 0.74 : 0.48)),
    ),
  );
  const sidebarOpen = mode === "claude" && activeSidebarPanel !== null;
  const gridWidth =
    mode === "canvas"
      ? Math.max(0, width - ACTIVITY_RAIL_WIDTH)
      : effectiveSidebarWidth;

  // Panel focus mode — when set, that panel is maximized to fill the grid and
  // its siblings are hidden (via CSS keyed off the classes below). All panels
  // stay mounted so their PTYs keep running. Persisted per tab (see the store's
  // `focusedId`) so reopening the app restores whichever panel was focused.
  const toggleFocus = useCallback(
    (id: string) => setFocused(focusedId === id ? null : id),
    [setFocused, focusedId],
  );

  const expandPanel = useCallback(
    (id: string) => {
      if (mode === "claude") {
        setFocused(id);
        setModeRaw(workspaceId, "canvas");
        return;
      }
      toggleFocus(id);
    },
    [mode, setFocused, setModeRaw, toggleFocus, workspaceId],
  );

  // Drop focus if the focused panel is closed/removed. The store clears focus at
  // each removal path too; this is a belt-and-suspenders guard for any it misses.
  useEffect(() => {
    if (focusedId && !auxiliaryPanels.some((panel) => panel.id === focusedId)) {
      setFocused(null);
    }
  }, [auxiliaryPanels, focusedId, setFocused]);

  useEffect(() => {
    if (sidebarPanelId && !auxiliaryPanels.some((panel) => panel.id === sidebarPanelId)) {
      setSidebarPanel(null);
    }
  }, [auxiliaryPanels, setSidebarPanel, sidebarPanelId]);

  // Esc exits focus mode (only for the foreground tab).
  useEffect(() => {
    if (!focusedId || !active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFocused(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedId, active, setFocused]);

  const rowHeight = useMemo(() => {
    const usable = height - (GRID_ROWS - 1) * GRID_MARGIN[1];
    return Math.max(MIN_ROW_HEIGHT, Math.floor(usable / GRID_ROWS));
  }, [height]);

  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  useEffect(() => () => resizeCleanupRef.current?.(), []);

  const beginSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      resizeCleanupRef.current?.();
      const startX = event.clientX;
      const startWidth = effectiveSidebarWidth;
      const previousCursor = document.body.style.cursor;
      const previousSelection = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      setResizingSidebar(true);

      const onMove = (moveEvent: PointerEvent) => {
        const mainStageWidth = editorSidebarActive ? 160 : 360;
        const available = Math.max(
          MIN_WORKSPACE_SIDEBAR_WIDTH,
          width - ACTIVITY_RAIL_WIDTH - mainStageWidth,
        );
        const maxWidth = Math.min(MAX_WORKSPACE_SIDEBAR_WIDTH, available);
        const next = Math.max(
          MIN_WORKSPACE_SIDEBAR_WIDTH,
          Math.min(maxWidth, startWidth + moveEvent.clientX - startX),
        );
        setSidebarWidthRaw(workspaceId, next);
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousSelection;
        setResizingSidebar(false);
        resizeCleanupRef.current = null;
      };
      resizeCleanupRef.current = cleanup;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", cleanup);
      window.addEventListener("pointercancel", cleanup);
    },
    [
      editorSidebarActive,
      effectiveSidebarWidth,
      setSidebarWidthRaw,
      width,
      workspaceId,
    ],
  );

  // Snapshot the full layout when a drag begins so handleDragStop can
  // identify displaced panels by their pre-drag positions.
  const preDragRef = useRef<Layout>([]);
  // While a drag is in flight (and for one frame after the drop commits),
  // onLayoutChange must not write RGL's internal layout into the store — it
  // fires after onDragStop and would clobber the drop resolution with the
  // unresolved (possibly overlapping) positions.
  const dragActiveRef = useRef(false);

  const handleDragStart = useCallback((layout: Layout) => {
    dragActiveRef.current = true;
    preDragRef.current = [...layout];
  }, []);

  /**
   * Collision resolution on drop — delegated to resolveDrop (swap → resize →
   * relocate → abort). RGL with noCompactor leaves displaced panels where its
   * internal collision pass shoved them (possibly outside maxRows), so the
   * result is always rebuilt from the pre-drag snapshot; a null resolution
   * restores that snapshot wholesale, snapping the drag back.
   */
  const handleDragStop = useCallback(
    (_layout: Layout, oldItem: LayoutItem | null, newItem: LayoutItem | null) => {
      if (!oldItem || !newItem) {
        dragActiveRef.current = false;
        return;
      }
      const pre = preDragRef.current;
      setGrid(resolveDrop(pre, oldItem, newItem) ?? pre.map(clampToGrid));
      // Lift the suppression only after RGL's post-drop onLayoutChange burst.
      requestAnimationFrame(() => { dragActiveRef.current = false; });
    },
    [setGrid],
  );

  const handleLayoutChange = useCallback(
    (next: Layout) => {
      if (dragActiveRef.current) return;
      setGrid(next.map(clampToGrid));
    },
    [setGrid],
  );

  // Memoized children — never rebuilt on drag/resize so live terminals
  // survive grid gestures without remounting.
  const children = useMemo(
    () =>
      auxiliaryPanels.map((panel) => {
        const renderer = PANEL_RENDERERS[panel.kind];
        if (!renderer) return null;
        const isFocused = focusedId === panel.id;
        const isSidebarActive = mode === "claude" && sidebarPanelId === panel.id;
        return (
          <div
            key={panel.id}
            className={`overflow-hidden ${
              mode === "claude"
                ? isSidebarActive
                  ? "rt-sidebar-panel-active"
                  : "rt-sidebar-panel-hidden"
                : isFocused
                  ? "rt-panel-focused"
                  : ""
            }`}
          >
            <PanelFrame
              icon={PANEL_META[panel.kind].icon}
              title={panel.title}
              workspaceId={workspaceId}
              panelId={panel.id}
              onClose={() => requestClosePanel(panel.id, panel.kind)}
              focused={mode === "canvas" && isFocused}
              onToggleFocus={() => expandPanel(panel.id)}
              // xterm panels scale their own font (see PanelFrame.selfZoom):
              // a scaled ancestor would break their text selection.
              selfZoom={panel.kind === "terminal"}
            >
              {renderer({ cwd, workspaceId, panelId: panel.id, active })}
            </PanelFrame>
          </div>
        );
      }),
    [
      active,
      auxiliaryPanels,
      cwd,
      expandPanel,
      focusedId,
      mode,
      requestClosePanel,
      sidebarPanelId,
      workspaceId,
    ],
  );

  const pendingClosePanel =
    auxiliaryPanels.find((panel) => panel.id === pendingClosePanelId) ?? null;

  return (
    <div ref={ref} className="relative h-full w-full overflow-hidden">
      <nav
        className="rt-workspace-rail absolute inset-y-0 left-0 z-30 flex w-[42px] flex-col items-center gap-1 py-2"
        aria-label="Workspace tools"
      >
        <button
          type="button"
          onClick={() => {
            setModeRaw(workspaceId, "claude");
            setSidebarPanel(null);
          }}
          className={`rt-workspace-rail-button ${
            mode === "claude" && !sidebarOpen ? "rt-workspace-rail-button-active" : ""
          }`}
          title="Claude workspace"
          aria-label="Claude workspace"
          aria-pressed={mode === "claude" && !sidebarOpen}
        >
          <Icon name="claudeLogo" size={16} />
        </button>

        <span className="my-1 h-px w-5 bg-[var(--rt-border)]" />

        {AUXILIARY_PANEL_KINDS.map((kind) => {
          const meta = PANEL_META[kind];
          const panel = auxiliaryPanels.find((item) => item.kind === kind);
          const selected =
            mode === "claude" && !!panel && activeSidebarPanel?.id === panel.id;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => toggleSidebarPanel(kind)}
              className={`rt-workspace-rail-button ${
                selected ? "rt-workspace-rail-button-active" : ""
              }`}
              title={`${selected ? "Close" : "Open"} ${meta.label}`}
              aria-label={`${selected ? "Close" : "Open"} ${meta.label}`}
              aria-pressed={selected}
            >
              <Icon name={meta.icon} size={15} />
              {panel && !selected && (
                <span className="absolute bottom-1 right-1 h-1 w-1 rounded-full bg-[var(--rt-accent)] opacity-70" />
              )}
            </button>
          );
        })}

        <span className="min-h-2 flex-1" />
        <button
          type="button"
          onClick={() => {
            setFocused(null);
            setModeRaw(workspaceId, mode === "canvas" ? "claude" : "canvas");
          }}
          className={`rt-workspace-rail-button ${
            mode === "canvas" ? "rt-workspace-rail-button-active" : ""
          }`}
          title={mode === "canvas" ? "Return to Claude" : "Open full canvas"}
          aria-label={mode === "canvas" ? "Return to Claude" : "Open full canvas"}
          aria-pressed={mode === "canvas"}
        >
          <Icon name="layoutGrid" size={15} />
        </button>
      </nav>

      <div
        className={`absolute inset-y-0 right-0 ${
          resizingSidebar ? "" : "transition-[left] duration-200 ease-out motion-reduce:transition-none"
        }`}
        style={{
          left:
            mode === "claude"
              ? ACTIVITY_RAIL_WIDTH + (sidebarOpen ? effectiveSidebarWidth : 0)
              : ACTIVITY_RAIL_WIDTH,
          visibility: mode === "claude" ? "visible" : "hidden",
          zIndex: mode === "claude" ? 1 : 0,
          pointerEvents: mode === "claude" ? "auto" : "none",
        }}
        aria-hidden={mode !== "claude"}
      >
        <ClaudeCodePanel
          cwd={cwd}
          workspaceId={workspaceId}
          active={active && mode === "claude"}
        />
      </div>

      <div
        className={`rt-workspace-sidebar absolute bottom-0 top-0 overflow-hidden ${
          resizingSidebar
            ? ""
            : "transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none"
        }`}
        style={{
          left: ACTIVITY_RAIL_WIDTH,
          right: mode === "canvas" ? 0 : undefined,
          width: mode === "canvas" ? undefined : effectiveSidebarWidth,
          visibility: mode === "canvas" || sidebarOpen ? "visible" : "hidden",
          opacity: mode === "canvas" || sidebarOpen ? 1 : 0,
          zIndex: mode === "canvas" || sidebarOpen ? 10 : 0,
          pointerEvents: mode === "canvas" || sidebarOpen ? "auto" : "none",
        }}
        aria-hidden={mode !== "canvas" && !sidebarOpen}
      >
        {!mounted ? null : auxiliaryPanels.length === 0 ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="rt-text-muted text-sm">
              No workspace panels are visible. Add one from the toolbar, or:
            </p>
            <button
              type="button"
              onClick={() => resetLayoutRaw(workspaceId)}
              className="rt-btn-outline px-3 py-1.5 text-sm font-medium"
            >
              Restore default layout
            </button>
          </div>
        ) : (
          <GridLayout
            className={`retermina-grid ${
              mode === "claude"
                ? "rt-sidebar-grid"
                : focusedId
                  ? "rt-has-focus"
                  : ""
            }`}
            width={gridWidth}
            layout={auxiliaryGrid}
            onLayoutChange={handleLayoutChange}
            onDragStart={handleDragStart}
            onDragStop={handleDragStop}
            compactor={noCompactor}
            gridConfig={{
              cols: GRID_COLS,
              rowHeight,
              margin: GRID_MARGIN,
              containerPadding: [0, 0],
              maxRows: GRID_ROWS,
            }}
            dragConfig={{
              // Disable drag/resize while a panel is maximized.
              enabled: mode === "canvas" && !focusedId,
              handle: ".panel-drag-handle",
              cancel: ".panel-no-drag",
              bounded: true,
            }}
            resizeConfig={{
              enabled: mode === "canvas" && !focusedId,
              handles: ["n", "ne", "nw", "se", "s", "e", "w", "sw"],
            }}
          >
            {children}
          </GridLayout>
        )}
      </div>

      {sidebarOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize workspace sidebar"
          onPointerDown={beginSidebarResize}
          className="rt-workspace-sidebar-resizer absolute bottom-0 top-0 z-40 w-1.5 cursor-col-resize"
          style={{ left: ACTIVITY_RAIL_WIDTH + effectiveSidebarWidth - 3 }}
        />
      )}

      <ConfirmDialog
        open={pendingClosePanel !== null}
        title={`Close ${pendingClosePanel?.title ?? "panel"}?`}
        message={
          <>
            “{pendingClosePanel?.title}” has a live session. Closing it ends any
            running processes in this panel.
          </>
        }
        confirmLabel="Close panel"
        cancelLabel="Keep open"
        destructive
        onConfirm={() => {
          if (pendingClosePanelId) closePanel(pendingClosePanelId);
          setPendingClosePanelId(null);
        }}
        onCancel={() => setPendingClosePanelId(null)}
      />
    </div>
  );
}

export default WorkspaceLayout;
