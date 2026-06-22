import { useRef, useState, useEffect } from "react";

import Icon from "../components/Icon";
import SettingsModal from "../components/SettingsModal";
import CommandMenu from "../components/workspace/CommandMenu";
import IrisBar from "../components/workspace/IrisBar";
import PresetsMenu from "../components/workspace/PresetsMenu";
import WorkspaceLayout from "../components/workspace/WorkspaceLayout";
import { prettyPath } from "../lib/format";
import { PANEL_KINDS, PANEL_META } from "../lib/workspaceLayout";
import { useWorkspaceStore } from "../store/workspace";
import { useAppStore } from "../store/app";

export interface TerminalWorkspaceProps {
  cwd?: string | null;
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
                      <path d="M1.5 5l2.5 2.5L8.5 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
// TerminalWorkspace
// ---------------------------------------------------------------------------

export function TerminalWorkspace({ cwd = null, onLeave }: TerminalWorkspaceProps) {
  const title        = cwd ? prettyPath(cwd) : "Blank Terminal";
  const panels       = useWorkspaceStore((s) => s.panels);
  const togglePanel  = useWorkspaceStore((s) => s.togglePanel);
  const resetLayout  = useWorkspaceStore((s) => s.resetLayout);
  const toolbarStyle = useAppStore((s) => s.toolbarStyle);
  const topBarStyle  = useAppStore((s) => s.topBarStyle);
  const showLabels   = topBarStyle === "icon-and-text";
  const visibleKinds = new Set(panels.map((p) => p.kind));

  const [settingsOpen, setSettingsOpen] = useState(false);

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

      <div className="min-h-0 flex-1 p-2">
        <WorkspaceLayout cwd={cwd} />
      </div>

      <IrisBar cwd={cwd} />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default TerminalWorkspace;
