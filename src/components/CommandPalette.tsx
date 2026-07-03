/**
 * Cmd+K Command Palette
 *
 * A full-screen overlay with a fuzzy search input that surfaces actions
 * across the entire app: panel toggles, themes, workspace presets, Looms, and
 * recent workspaces. Results are keyboard-navigable; Enter runs the
 * highlighted action and closes the palette.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import Icon from "./Icon";
import { useAppStore } from "../store/app";
import { useWorkspaceStore } from "../store/workspace";
import { useWorkspacesStore } from "../store/workspaces";
import { useLoomStore } from "../store/loom";
import { usePresetsStore } from "../store/presets";
import { useRecentStore } from "../store/recent";
import { useTheme } from "../theme/ThemeProvider";
import { PANEL_KINDS, PANEL_META } from "../lib/workspaceLayout";
import type { IconName } from "./Icon";

// ---------------------------------------------------------------------------
// Unified action type
// ---------------------------------------------------------------------------

interface PaletteAction {
  id:        string;
  title:     string;
  subtitle?: string;
  group:     string;
  icon:      IconName;
  onRun:     () => void;
}

// ---------------------------------------------------------------------------
// Fuzzy match — score a query against a string
// ---------------------------------------------------------------------------

function score(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.startsWith(q))  return 100;
  if (t.includes(q))    return 60;
  // subsequence
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length ? 25 : 0;
}

function bestScore(query: string, ...texts: string[]): number {
  return Math.max(...texts.map((t) => score(query, t)));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface CommandPaletteProps {
  open:    boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Store hooks
  const openTerminal  = useAppStore((s) => s.openTerminal);
  const panels        = useWorkspaceStore((s) => s.panels);
  const togglePanel   = useWorkspaceStore((s) => s.togglePanel);
  const loadLayout    = useWorkspaceStore((s) => s.loadLayout);
  const recentEntries = useRecentStore((s) => s.entries);
  const presets       = usePresetsStore((s) => s.presets);
  const looms         = useLoomStore((s) => s.presets);
  const loadLoom      = useLoomStore((s) => s.loadPreset);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setSettingsTab  = useAppStore((s) => s.setSettingsTab);
  const { themes, setTheme, themeId } = useTheme();

  const SETTINGS_TABS: { id: string; label: string }[] = [
    { id: "theme", label: "Theme" },
    { id: "appearance", label: "Appearance" },
    { id: "loom", label: "Loom" },
    { id: "accessibility", label: "Accessibility" },
    { id: "font", label: "Font" },
    { id: "shortcuts", label: "Shortcuts" },
    { id: "version", label: "Version" },
  ];
  const openSettings = (tab: string) => { setSettingsTab(tab); setSettingsOpen(true); };

  const visibleKinds = new Set(panels.map((p) => p.kind));

  // ── Build full action list ──────────────────────────────────────────────

  const allActions = useMemo<PaletteAction[]>(() => {
    const actions: PaletteAction[] = [];

    // Panel toggles
    for (const kind of PANEL_KINDS) {
      const meta   = PANEL_META[kind];
      const active = visibleKinds.has(kind);
      actions.push({
        id:       `panel-${kind}`,
        title:    `${active ? "Hide" : "Show"} ${meta.label}`,
        group:    "Panels",
        icon:     meta.icon,
        onRun:    () => togglePanel(kind),
      });
    }

    // Themes
    for (const theme of themes) {
      actions.push({
        id:       `theme-${theme.id}`,
        title:    theme.label,
        subtitle: theme.description,
        group:    "Themes",
        icon:     "palette",
        onRun:    () => setTheme(theme.id),
      });
    }

    // Presets — layout-only workspace snapshots
    for (const preset of presets) {
      actions.push({
        id:       `preset-${preset.id}`,
        title:    preset.name,
        subtitle: `${preset.panels.length} panel${preset.panels.length !== 1 ? "s" : ""}`,
        group:    "Presets",
        icon:     "files",
        onRun:    () => {
          loadLayout(preset.panels, preset.grid);
          useWorkspacesStore.getState().setLayoutTemplate({
            panels: preset.panels,
            grid: preset.grid,
            panelFontSizes: {},
          });
        },
      });
    }

    // Looms — full theme + layout bundles
    for (const loom of looms) {
      actions.push({
        id:       `loom-${loom.id}`,
        title:    `Apply Loom: ${loom.name}`,
        subtitle: `${loom.workspace.panels.length} panel${loom.workspace.panels.length !== 1 ? "s" : ""}`,
        group:    "Looms",
        icon:     "layers",
        onRun:    () => loadLoom(loom.id),
      });
    }

    // Settings — open the overlay to a specific tab
    for (const t of SETTINGS_TABS) {
      actions.push({
        id:       `settings-${t.id}`,
        title:    `Settings: ${t.label}`,
        group:    "Settings",
        icon:     "settings",
        onRun:    () => openSettings(t.id),
      });
    }

    // Recent workspaces
    for (const entry of recentEntries) {
      actions.push({
        id:       `recent-${entry.path}`,
        title:    entry.name,
        subtitle: entry.path,
        group:    "Recent",
        icon:     "folder",
        onRun:    () => openTerminal(entry.path),
      });
    }

    return actions;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels, presets, looms, recentEntries, themes, themeId]);

  // ── Filter + sort ───────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return allActions;
    return allActions
      .map((a) => ({
        action: a,
        s: bestScore(q, a.title, a.group, a.subtitle ?? ""),
      }))
      .filter((e) => e.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((e) => e.action);
  }, [allActions, query]);

  // ── Reset state on open ─────────────────────────────────────────────────

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // ── Keyboard navigation ─────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const action = filtered[activeIdx];
        if (action) { action.onRun(); onClose(); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, filtered, activeIdx, onClose]);

  if (!open) return null;

  // Group results for display
  const grouped = useMemo(() => {
    const map = new Map<string, PaletteAction[]>();
    for (const a of filtered) {
      if (!map.has(a.group)) map.set(a.group, []);
      map.get(a.group)!.push(a);
    }
    return map;
  }, [filtered]);

  let globalIdx = 0;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="rt-menu flex w-full max-w-xl flex-col overflow-hidden rounded-2xl shadow-2xl">
        {/* Search input */}
        <div className="flex items-center gap-2.5 border-b border-[var(--rt-border)] px-4 py-3">
          <Icon name="search" size={16} className="rt-text-faint shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search panels, themes, presets, workspaces…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--rt-text-faint)]"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="rt-text-faint shrink-0 text-[10px]">Esc to close</span>
        </div>

        {/* Results */}
        <div className="max-h-[min(420px,60vh)] overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <p className="rt-text-muted py-6 text-center text-sm">No results</p>
          ) : (
            Array.from(grouped.entries()).map(([group, actions]) => (
              <div key={group}>
                <p className="rt-text-faint px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-widest">
                  {group}
                </p>
                {actions.map((action) => {
                  const idx    = globalIdx++;
                  const active = idx === activeIdx;
                  return (
                    <button
                      key={action.id}
                      type="button"
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => { action.onRun(); onClose(); }}
                      className={`rt-menu-item flex w-full items-center gap-3 px-3 py-2 text-left ${
                        active ? "bg-[var(--rt-surface-hover)]" : ""
                      }`}
                    >
                      <Icon
                        name={action.icon}
                        size={15}
                        className="rt-text-muted shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {action.title}
                        </span>
                        {action.subtitle && (
                          <span className="rt-text-faint block truncate text-[11px]">
                            {action.subtitle}
                          </span>
                        )}
                      </span>
                      <span className="rt-text-faint shrink-0 text-[10px] font-medium uppercase tracking-wide">
                        {action.group}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
