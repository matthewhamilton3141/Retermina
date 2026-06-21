import { useRef, useState, useEffect } from "react";

import Icon from "../components/Icon";
import ThemeSwitcher from "../components/ThemeSwitcher";
import CommandMenu from "../components/workspace/CommandMenu";
import IrisBar from "../components/workspace/IrisBar";
import PresetsMenu from "../components/workspace/PresetsMenu";
import WorkspaceLayout from "../components/workspace/WorkspaceLayout";
import { prettyPath } from "../lib/format";
import { PANEL_KINDS, PANEL_META } from "../lib/workspaceLayout";
import { useWorkspaceStore } from "../store/workspace";
import { useAppStore, type ToolbarStyle } from "../store/app";

export interface TerminalWorkspaceProps {
  cwd?: string | null;
  onLeave: () => void;
}

// ---------------------------------------------------------------------------
// Panels dropdown — single button that opens a checklist of all panel kinds
// ---------------------------------------------------------------------------

function PanelsDropdown() {
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
        <span>Panels</span>
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
// Toolbar style picker — small popover to switch between dropdown / icons
// ---------------------------------------------------------------------------

const TOOLBAR_OPTIONS: { style: ToolbarStyle; label: string; desc: string }[] = [
  { style: "dropdown", label: "Panels dropdown",  desc: "One button opens a panel checklist" },
  { style: "icons",    label: "Icon strip",       desc: "Individual icon buttons, no labels" },
];

function ToolbarStylePicker() {
  const toolbarStyle    = useAppStore((s) => s.toolbarStyle);
  const setToolbarStyle = useAppStore((s) => s.setToolbarStyle);

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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Toolbar layout"
        className={`rt-btn flex h-7 w-7 items-center justify-center ${open ? "rt-btn-active" : ""}`}
      >
        <Icon name="settings" size={13} />
      </button>

      {open && (
        <div className="rt-menu absolute right-0 top-full z-[100] mt-1 w-52 py-1 shadow-lg">
          <p className="rt-text-faint px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest">
            Toolbar style
          </p>
          {TOOLBAR_OPTIONS.map(({ style, label, desc }) => {
            const active = toolbarStyle === style;
            return (
              <button
                key={style}
                type="button"
                onClick={() => { setToolbarStyle(style); setOpen(false); }}
                className={`rt-menu-item flex w-full items-start gap-2.5 px-3 py-2 text-left ${active ? "rt-btn-active" : ""}`}
              >
                <span className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                  active ? "border-[var(--rt-accent)] bg-[var(--rt-accent)]" : "border-[var(--rt-border)]"
                }`}>
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span>
                  <span className="block text-xs font-medium">{label}</span>
                  <span className="rt-text-faint block text-[10px]">{desc}</span>
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
  const visibleKinds = new Set(panels.map((p) => p.kind));

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

          {/* Panel toggles — rendered differently per toolbarStyle */}
          {toolbarStyle === "dropdown" ? (
            <PanelsDropdown />
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
                  className={`rt-btn-outline flex items-center px-2 py-1 text-xs font-medium ${active ? "rt-btn-active" : ""}`}
                >
                  <Icon name={meta.icon} size={14} />
                </button>
              );
            })
          )}

          <div className="rt-divider mx-1 h-5 w-px" />

          {/* Reset — icon only in both modes */}
          <button
            type="button"
            onClick={resetLayout}
            title="Reset layout to default"
            className="rt-btn-outline flex items-center px-2 py-1 text-xs font-medium"
          >
            <Icon name="sync" size={14} />
          </button>

          <div className="rt-divider mx-1 h-5 w-px" />
          <PresetsMenu />
          <div className="rt-divider mx-1 h-5 w-px" />
          <CommandMenu cwd={cwd} />
          <div className="rt-divider mx-1 h-5 w-px" />
          <ThemeSwitcher align="right" />
          <ToolbarStylePicker />
        </div>
      </header>

      <div className="min-h-0 flex-1 p-2">
        <WorkspaceLayout cwd={cwd} />
      </div>

      <IrisBar cwd={cwd} />
    </div>
  );
}

export default TerminalWorkspace;
