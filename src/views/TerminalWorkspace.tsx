import { useCallback, useRef, useState, useEffect } from "react";

import Icon from "../components/Icon";
import SettingsModal from "../components/SettingsModal";
import CommandMenu from "../components/workspace/CommandMenu";
import IrisBar from "../components/workspace/IrisBar";
import PresetsMenu from "../components/workspace/PresetsMenu";
import WorkspaceLayout from "../components/workspace/WorkspaceLayout";
import { prettyPath } from "../lib/format";
import { PANEL_KINDS, PANEL_META } from "../lib/workspaceLayout";
import { useWorkspaceStore } from "../store/workspace";
import { useWorkspacesStore } from "../store/workspaces";
import { useAppStore } from "../store/app";
import { useRecentStore } from "../store/recent";

export interface TerminalWorkspaceProps {
  onLeave: () => void;
}

// ---------------------------------------------------------------------------
// Panels dropdown — single button that opens a checklist of all panel kinds
// ---------------------------------------------------------------------------

function PanelsDropdown({ showLabel = false }: { showLabel?: boolean }) {
  const panels      = useWorkspaceStore((s) => s.panels);
  const togglePanel = useWorkspaceStore((s) => s.togglePanel);
  const visibleKinds = new Set(panels.map((p) => p.kind));

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeCount = visibleKinds.size;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`rt-btn-outline flex items-center gap-1.5 px-2 py-1 text-xs font-medium ${open ? "rt-btn-active" : ""}`}
        title="Toggle panels"
      >
        <Icon name="layoutGrid" size={14} />
        {showLabel && <span>Panels</span>}
        {activeCount > 0 && (
          <span className="rt-badge px-1 py-0 text-[9px] tabular-nums">{activeCount}</span>
        )}
        <Icon name={open ? "chevronDown" : "chevronRight"} size={11} className="rt-text-faint" />
      </button>

      {open && (
        <div className="rt-menu absolute right-0 top-full z-[100] mt-1 min-w-[160px] py-1 shadow-lg">
          {PANEL_KINDS.map((kind) => {
            const meta   = PANEL_META[kind];
            const active = visibleKinds.has(kind);
            return (
              <button
                key={kind}
                type="button"
                onClick={() => { togglePanel(kind); }}
                className="rt-menu-item flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm"
              >
                <Icon name={meta.icon} size={14} className="shrink-0" />
                <span className="flex-1">{meta.label}</span>
                {/* checkmark */}
                <span className={`h-3.5 w-3.5 shrink-0 rounded-sm border transition-colors ${
                  active
                    ? "border-[var(--rt-accent)] bg-[var(--rt-accent)]"
                    : "border-[var(--rt-border)]"
                }`}>
                  {active && (
                    <svg viewBox="0 0 10 10" fill="none" className="h-full w-full p-[1.5px]">
                      <path d="M1.5 5l2.5 2.5L8.5 2.5" style={{ stroke: "var(--rt-accent-contrast, #fff)" }} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab strip — one button per open workspace, plus a new-tab button
// ---------------------------------------------------------------------------

function WorkspaceTabs() {
  const tabs           = useWorkspacesStore((s) => s.tabs);
  const activeId       = useWorkspacesStore((s) => s.activeId);
  const setActive      = useWorkspacesStore((s) => s.setActive);
  const closeWorkspace = useWorkspacesStore((s) => s.closeWorkspace);
  const moveTab        = useWorkspacesStore((s) => s.moveTab);

  // Drag-reorder bookkeeping + edge-fade affordance for overflowing strips.
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });

  const updateFade = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setFade((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => { updateFade(); }, [tabs.length, updateFade]);
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const obs = new ResizeObserver(updateFade);
    obs.observe(el);
    return () => obs.disconnect();
  }, [updateFade]);

  if (tabs.length === 0) return null;

  // Fade whichever edges have hidden tabs (WebKit prefix for the Tauri webview).
  const maskStops = [
    fade.left ? "transparent, #000 16px" : "#000",
    fade.right ? "#000 calc(100% - 16px), transparent" : "#000",
  ].join(", ");
  const mask = fade.left || fade.right ? `linear-gradient(to right, ${maskStops})` : undefined;

  return (
    <div className="rt-toolbar relative z-50 flex shrink-0 items-center gap-1 border-t border-[var(--rt-border)] px-2 py-1">
      <div
        ref={stripRef}
        onScroll={updateFade}
        style={{ maskImage: mask, WebkitMaskImage: mask }}
        className="flex min-w-0 items-center gap-1 overflow-x-auto"
      >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            draggable
            onDragStart={(e) => { dragId.current = tab.id; e.dataTransfer.effectAllowed = "move"; }}
            onDragOver={(e) => { e.preventDefault(); if (dragId.current && dragId.current !== tab.id) setDragOverId(tab.id); }}
            onDragLeave={() => setDragOverId((cur) => (cur === tab.id ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId.current && dragId.current !== tab.id) moveTab(dragId.current, tab.id);
              dragId.current = null;
              setDragOverId(null);
            }}
            onDragEnd={() => { dragId.current = null; setDragOverId(null); }}
            onMouseDown={() => setActive(tab.id)}
            // Middle-click closes the tab, matching browser/editor convention.
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeWorkspace(tab.id); } }}
            title={tab.cwd ?? "Blank Terminal"}
            className={`group/tab flex max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors ${
              active ? "rt-btn-active" : "rt-btn-outline"
            } ${dragOverId === tab.id ? "ring-1 ring-[var(--rt-accent)]" : ""}`}
          >
            <Icon name="terminal" size={12} className="shrink-0" />
            <span className="min-w-0 truncate">{tab.title}</span>
            <button
              type="button"
              onMouseDown={(e) => {
                e.stopPropagation();
                closeWorkspace(tab.id);
              }}
              title="Close workspace"
              className="rt-btn ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover/tab:opacity-100"
            >
              <Icon name="close" size={9} aria-label="Close workspace" />
            </button>
          </div>
        );
      })}
      </div>
      <NewTabMenu />
    </div>
  );
}

// ---------------------------------------------------------------------------
// New-tab button — dropdown offering a blank workspace or a recent folder
// ---------------------------------------------------------------------------

function NewTabMenu() {
  const newWorkspace = useWorkspacesStore((s) => s.newWorkspace);
  const openTerminal = useAppStore((s) => s.openTerminal);
  const recents      = useRecentStore((s) => s.entries);
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="New workspace"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`rt-btn flex h-6 w-6 shrink-0 items-center justify-center ${open ? "rt-btn-active" : ""}`}
      >
        <Icon name="plus" size={13} aria-label="New workspace" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div className="rt-menu absolute left-0 top-full z-50 mt-1 w-60">
            <div className="p-1">
              <button
                type="button"
                onClick={() => { newWorkspace(null); close(); }}
                className="rt-menu-item flex w-full items-center gap-2 px-3 py-2 text-sm"
              >
                <Icon name="plus" size={14} className="rt-text-muted shrink-0" />
                Blank workspace
              </button>
            </div>

            {recents.length > 0 && (
              <>
                <div className="rt-divider-b mx-1" />
                <p className="rt-text-faint px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide">
                  Recent
                </p>
                <ul className="max-h-56 overflow-y-auto p-1 pt-0">
                  {recents.map((entry) => (
                    <li key={entry.path}>
                      <button
                        type="button"
                        onClick={() => { openTerminal(entry.path); close(); }}
                        title={entry.path}
                        className="rt-menu-item flex w-full min-w-0 flex-col items-start px-3 py-2 text-left"
                      >
                        <span className="block w-full truncate text-sm font-medium">
                          {entry.name}
                        </span>
                        <span className="rt-text-faint block w-full truncate text-[11px]">
                          {prettyPath(entry.path)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TerminalWorkspace
// ---------------------------------------------------------------------------

export function TerminalWorkspace({ onLeave }: TerminalWorkspaceProps) {
  const tabs         = useWorkspacesStore((s) => s.tabs);
  const activeId     = useWorkspacesStore((s) => s.activeId);
  const activeTab    = tabs.find((t) => t.id === activeId) ?? tabs[0] ?? null;
  const cwd          = activeTab?.cwd ?? null;
  const title        = cwd ? prettyPath(cwd) : "Blank Terminal";
  const panels       = useWorkspaceStore((s) => s.panels);
  const togglePanel  = useWorkspaceStore((s) => s.togglePanel);
  const resetLayout  = useWorkspaceStore((s) => s.resetLayout);
  const toolbarStyle = useAppStore((s) => s.toolbarStyle);
  const topBarStyle  = useAppStore((s) => s.topBarStyle);
  const showLabels   = topBarStyle === "icon-and-text";
  const visibleKinds = new Set(panels.map((p) => p.kind));

  const settingsOpen    = useAppStore((s) => s.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);

  // Closing the last workspace returns to the Launch Hub.
  useEffect(() => {
    if (tabs.length === 0) onLeave();
  }, [tabs.length, onLeave]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="rt-toolbar relative z-50 flex items-center gap-2 px-3 py-2">
        {/* Left: back + title */}
        <button
          type="button"
          onClick={onLeave}
          title="Back to Launch Hub"
          className="rt-btn flex h-7 w-7 shrink-0 items-center justify-center"
        >
          <Icon name="back" size={16} aria-label="Back to Launch Hub" />
        </button>
        <Icon name="terminal" size={15} className="rt-accent-text shrink-0" />
        <span className="min-w-0 truncate text-sm font-medium" title={cwd ?? undefined}>
          {title}
        </span>

        {/* Right: panel controls + utility buttons */}
        <div className="ml-auto flex shrink-0 items-center gap-1">

          {/* Panel toggles */}
          {toolbarStyle === "dropdown" ? (
            <PanelsDropdown showLabel={showLabels} />
          ) : (
            PANEL_KINDS.map((kind) => {
              const meta   = PANEL_META[kind];
              const active = visibleKinds.has(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => togglePanel(kind)}
                  aria-pressed={active}
                  title={`${active ? "Hide" : "Show"} ${meta.label}`}
                  className={`rt-btn-outline flex items-center gap-1.5 px-2 py-1 text-xs font-medium ${active ? "rt-btn-active" : ""}`}
                >
                  <Icon name={meta.icon} size={14} />
                  {showLabels && <span>{meta.label}</span>}
                </button>
              );
            })
          )}

          <div className="rt-divider mx-1 h-5 w-px" />

          <button
            type="button"
            onClick={resetLayout}
            title="Reset layout to default"
            className="rt-btn-outline flex items-center gap-1.5 px-2 py-1 text-xs font-medium"
          >
            <Icon name="sync" size={14} />
            {showLabels && <span>Reset</span>}
          </button>

          <div className="rt-divider mx-1 h-5 w-px" />
          <PresetsMenu />
          <div className="rt-divider mx-1 h-5 w-px" />
          <CommandMenu cwd={cwd} />
          <div className="rt-divider mx-1 h-5 w-px" />
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            className={`rt-btn-outline flex items-center gap-1.5 px-2 py-1 text-xs font-medium ${settingsOpen ? "rt-btn-active" : ""}`}
          >
            <Icon name="settings" size={14} />
            {showLabels && <span>Settings</span>}
          </button>
        </div>
      </header>

      <WorkspaceTabs />

      {/* Every tab stays mounted so its terminals keep running in the
          background; inactive tabs are hidden with `visibility` (not display),
          which preserves their measured size so the grids stay laid out and
          the PTYs stay correctly sized. */}
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => {
          const active = tab.id === activeTab?.id;
          return (
            <div
              key={tab.id}
              className="absolute inset-0 p-2"
              style={{
                visibility: active ? "visible" : "hidden",
                zIndex: active ? 1 : 0,
                pointerEvents: active ? "auto" : "none",
              }}
              aria-hidden={!active}
            >
              <WorkspaceLayout workspaceId={tab.id} cwd={tab.cwd} active={active} />
            </div>
          );
        })}
      </div>

      <IrisBar cwd={cwd} />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default TerminalWorkspace;
