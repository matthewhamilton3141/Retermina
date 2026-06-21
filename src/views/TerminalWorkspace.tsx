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
import { useAppStore, type ToolbarStyle, type TopBarStyle } from "../store/app";
import { FONTS } from "../lib/fonts";

const ACCENT_PRESETS: { name: string; hex: string }[] = [
  { name: "Emerald",  hex: "#10b981" },
  { name: "Violet",   hex: "#8b5cf6" },
  { name: "Blue",     hex: "#3b82f6" },
  { name: "Rose",     hex: "#f43f5e" },
  { name: "Amber",    hex: "#f59e0b" },
  { name: "Cyan",     hex: "#06b6d4" },
  { name: "Orange",   hex: "#f97316" },
  { name: "Indigo",   hex: "#6366f1" },
];

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
// Settings panel
// ---------------------------------------------------------------------------

const TOOLBAR_OPTIONS: { style: ToolbarStyle; label: string; desc: string }[] = [
  { style: "dropdown", label: "Panels dropdown", desc: "One button opens a panel checklist" },
  { style: "icons",    label: "Icon strip",      desc: "Individual icon-only buttons" },
];

const TOPBAR_OPTIONS: { style: TopBarStyle; label: string; desc: string }[] = [
  { style: "icon-only",     label: "Icons only",      desc: "Compact — icons with tooltips" },
  { style: "icon-and-text", label: "Icons + labels",  desc: "Spacious — icon beside text" },
];

function RadioGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { style: T; label: string; desc: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <>
      <p className="rt-text-faint px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest">
        {label}
      </p>
      {options.map(({ style, label: lbl, desc }) => {
        const active = value === style;
        return (
          <button
            key={style}
            type="button"
            onClick={() => onChange(style)}
            className={`rt-menu-item flex w-full items-start gap-2.5 px-3 py-1.5 text-left ${active ? "rt-btn-active" : ""}`}
          >
            <span className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors ${
              active ? "border-[var(--rt-accent)] bg-[var(--rt-accent)]" : "border-[var(--rt-border)]"
            }`}>
              {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
            </span>
            <span>
              <span className="block text-xs font-medium">{lbl}</span>
              <span className="rt-text-faint block text-[10px]">{desc}</span>
            </span>
          </button>
        );
      })}
    </>
  );
}

function SettingsPanel() {
  const toolbarStyle    = useAppStore((s) => s.toolbarStyle);
  const setToolbarStyle = useAppStore((s) => s.setToolbarStyle);
  const topBarStyle     = useAppStore((s) => s.topBarStyle);
  const setTopBarStyle  = useAppStore((s) => s.setTopBarStyle);
  const accentColor     = useAppStore((s) => s.accentColor);
  const setAccentColor  = useAppStore((s) => s.setAccentColor);
  const fontId          = useAppStore((s) => s.fontId);
  const setFontId       = useAppStore((s) => s.setFontId);
  const saveCustomTheme = useAppStore((s) => s.saveCustomTheme);

  const [open, setOpen]           = useState(false);
  const [presetName, setPresetName] = useState("");
  const [saving, setSaving]       = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeHex = accentColor ?? null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Settings"
        className={`rt-btn flex h-7 w-7 items-center justify-center ${open ? "rt-btn-active" : ""}`}
      >
        <Icon name="settings" size={13} />
      </button>

      {open && (
        <div className="rt-menu absolute right-0 top-full z-[100] mt-1 w-60 py-2 shadow-lg" style={{ maxHeight: "80vh", overflowY: "auto" }}>

          {/* ── Accent colour ── */}
          <p className="rt-text-faint px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-widest">
            Accent colour
          </p>
          <div className="grid grid-cols-8 gap-1.5 px-3 pb-2">
            {ACCENT_PRESETS.map(({ name, hex }) => {
              const active = activeHex === hex;
              return (
                <button
                  key={hex}
                  type="button"
                  title={name}
                  onClick={() => setAccentColor(hex)}
                  className="relative flex h-5 w-5 items-center justify-center rounded-full transition-transform hover:scale-110"
                  style={{ backgroundColor: hex }}
                >
                  {active && <span className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white ring-offset-1 ring-offset-transparent" />}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 px-3 pb-2">
            <label
              title="Custom colour"
              className="relative flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-[var(--rt-border)]"
              style={activeHex && !ACCENT_PRESETS.some(p => p.hex === activeHex)
                ? { backgroundColor: activeHex }
                : { background: "conic-gradient(red,yellow,lime,cyan,blue,magenta,red)" }
              }
            >
              <input
                type="color"
                value={activeHex ?? "#10b981"}
                onChange={(e) => setAccentColor(e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
            <input
              type="text"
              value={activeHex ?? ""}
              onChange={(e) => {
                const v = e.target.value.trim();
                if (/^#[0-9a-fA-F]{6}$/.test(v)) setAccentColor(v);
              }}
              placeholder="#hexcode"
              className="rt-input min-w-0 flex-1 px-2 py-0.5 font-mono text-[11px]"
              maxLength={7}
            />
            {activeHex && (
              <button type="button" onClick={() => setAccentColor(null)} className="rt-btn flex h-5 w-5 shrink-0 items-center justify-center" title="Reset">
                <Icon name="close" size={10} />
              </button>
            )}
          </div>

          {/* Save as preset */}
          {saving ? (
            <div className="flex items-center gap-1.5 px-3 pb-3">
              <input
                autoFocus
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && presetName.trim()) {
                    saveCustomTheme(presetName.trim());
                    setPresetName(""); setSaving(false);
                  }
                  if (e.key === "Escape") { setPresetName(""); setSaving(false); }
                }}
                placeholder="Preset name…"
                className="rt-input min-w-0 flex-1 px-2 py-1 text-[11px]"
              />
              <button
                type="button"
                disabled={!presetName.trim()}
                onClick={() => { saveCustomTheme(presetName.trim()); setPresetName(""); setSaving(false); }}
                className="rt-btn-outline px-2 py-1 text-[11px] disabled:opacity-40"
              >
                Save
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSaving(true)}
              className="rt-menu-item flex w-full items-center gap-2 px-3 py-1.5 text-[11px]"
            >
              <Icon name="plus" size={11} />
              Save as preset
            </button>
          )}

          <div className="rt-divider my-1.5 mx-3 h-px" />

          {/* ── Font ── */}
          <p className="rt-text-faint px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-widest">
            Font
          </p>
          <div className="px-3 pb-2 flex flex-col gap-0.5">
            {FONTS.map((f) => {
              const active = fontId === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFontId(f.id)}
                  className={`rt-menu-item flex items-center gap-2 rounded px-2 py-1.5 text-left ${active ? "rt-btn-active" : ""}`}
                >
                  <span className={`flex h-3 w-3 shrink-0 items-center justify-center rounded-full border ${
                    active ? "border-[var(--rt-accent)] bg-[var(--rt-accent)]" : "border-[var(--rt-border)]"
                  }`}>
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </span>
                  <span>
                    <span className="block text-xs font-medium" style={f.stack ? { fontFamily: f.stack } : undefined}>{f.name}</span>
                    <span className="rt-text-faint block text-[9px]">{f.description}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="rt-divider my-1.5 mx-3 h-px" />

          {/* ── Toolbar style ── */}
          <RadioGroup label="Panel toggles" options={TOOLBAR_OPTIONS} value={toolbarStyle} onChange={setToolbarStyle} />

          <div className="rt-divider my-1.5 mx-3 h-px" />

          {/* ── Top bar labels ── */}
          <RadioGroup label="Top bar labels" options={TOPBAR_OPTIONS} value={topBarStyle} onChange={setTopBarStyle} />
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
          <ThemeSwitcher align="right" />
          <SettingsPanel />
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
