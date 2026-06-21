import { useEffect, useRef, useState } from "react";

import Icon from "./Icon";
import { useTheme } from "../theme/ThemeProvider";
import { useAppStore } from "../store/app";
import type { ThemeId } from "../lib/theme";

export interface ThemeSwitcherProps {
  className?: string;
  align?: "left" | "right";
}

// ── Mini preview card ────────────────────────────────────────────────────────

interface PreviewCardProps {
  bg: string;
  surface: string;
  text: string;
  accent: string;
  label: string;
  active: boolean;
  onClick: () => void;
  onRemove?: () => void;
}

function PreviewCard({ bg, surface, text, accent, label, active, onClick, onRemove }: PreviewCardProps) {
  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onClick}
        className={`w-full rounded-lg overflow-hidden transition-transform hover:scale-105 ${
          active ? "ring-2 ring-offset-1 ring-offset-transparent" : ""
        }`}
        style={active ? { outline: `2px solid ${accent}`, outlineOffset: "2px" } : undefined}
      >
        {/* Mini mockup */}
        <div className="h-14 w-full relative" style={{ backgroundColor: bg }}>
          {/* Fake panel */}
          <div
            className="absolute inset-x-1.5 top-1.5 bottom-1.5 rounded-sm"
            style={{ backgroundColor: surface }}
          >
            {/* Fake title bar */}
            <div className="flex items-center gap-1 px-1.5 py-1" style={{ borderBottom: `1px solid ${text}18` }}>
              <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
              <div className="h-1 flex-1 rounded-full" style={{ backgroundColor: text, opacity: 0.2 }} />
            </div>
            {/* Fake content lines */}
            <div className="px-1.5 pt-1 flex flex-col gap-0.5">
              <div className="h-1 w-3/4 rounded-full" style={{ backgroundColor: text, opacity: 0.15 }} />
              <div className="h-1 w-1/2 rounded-full" style={{ backgroundColor: text, opacity: 0.1 }} />
            </div>
            {/* Fake accent button */}
            <div
              className="absolute bottom-1.5 right-1.5 rounded-sm px-1.5 py-0.5"
              style={{ backgroundColor: accent }}
            >
              <div className="h-1 w-3 rounded-full bg-white opacity-80" />
            </div>
          </div>
          {/* Active checkmark */}
          {active && (
            <div
              className="absolute top-1 right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full"
              style={{ backgroundColor: accent }}
            >
              <svg viewBox="0 0 8 8" fill="none" className="h-2 w-2">
                <path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </div>
        {/* Label */}
        <div className="rt-text-muted py-1 text-center text-[10px] font-medium truncate px-1">
          {label}
        </div>
      </button>

      {/* Remove button for custom themes */}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute -top-1 -right-1 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white"
          title="Remove preset"
        >
          <Icon name="close" size={8} />
        </button>
      )}
    </div>
  );
}

// ── Theme colour specs for previews ──────────────────────────────────────────

const THEME_PREVIEWS: Record<string, { bg: string; surface: string; text: string }> = {
  sleek:      { bg: "#0a0a0a", surface: "#171717", text: "#f5f5f5" },
  pastel:     { bg: "#f6f4fb", surface: "#ffffff", text: "#4c4361" },
  glass:      { bg: "#dde0e8", surface: "#f5f6f8", text: "#1c1e21" },
  minimalist: { bg: "#ffffff", surface: "#fafafa", text: "#18181b" },
  brutalism:  { bg: "#fafaf5", surface: "#ffffff", text: "#0a0a0a" },
};

// ── Component ────────────────────────────────────────────────────────────────

export function ThemeSwitcher({ className, align = "right" }: ThemeSwitcherProps) {
  const { themeId, theme, themes, setTheme } = useTheme();
  const customThemes    = useAppStore((s) => s.customThemes);
  const removeCustomTheme = useAppStore((s) => s.removeCustomTheme);
  const setThemeStore   = useAppStore((s) => s.setTheme);
  const setAccentColor  = useAppStore((s) => s.setAccentColor);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const applyCustomTheme = (ct: (typeof customThemes)[number]) => {
    setThemeStore(ct.baseThemeId);
    setAccentColor(ct.accentColor);
    setOpen(false);
  };

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Change theme"
        className="rt-btn-outline flex items-center gap-1.5 px-2 py-1 text-xs font-medium"
      >
        <Icon name="palette" size={14} />
        <span
          className="hidden sm:inline h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: theme.accentColor }}
        />
        <Icon name="chevronDown" size={11} />
      </button>

      {open && (
        <div
          className={`rt-menu absolute z-50 mt-2 w-72 p-3 ${align === "right" ? "right-0" : "left-0"}`}
        >
          {/* Built-in themes */}
          <p className="rt-text-faint mb-2 text-[10px] font-semibold uppercase tracking-widest">
            Themes
          </p>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {themes.map((engine) => {
              const prev = THEME_PREVIEWS[engine.id] ?? { bg: "#fff", surface: "#f0f0f0", text: "#000" };
              return (
                <PreviewCard
                  key={engine.id}
                  bg={prev.bg}
                  surface={prev.surface}
                  text={prev.text}
                  accent={engine.accentColor}
                  label={engine.label}
                  active={engine.id === themeId && !customThemes.find(ct => ct.id === (themeId as string))}
                  onClick={() => { setTheme(engine.id as ThemeId); setOpen(false); }}
                />
              );
            })}
          </div>

          {/* Custom presets */}
          {customThemes.length > 0 && (
            <>
              <div className="rt-divider mb-2 h-px" />
              <p className="rt-text-faint mb-2 text-[10px] font-semibold uppercase tracking-widest">
                My Presets
              </p>
              <div className="grid grid-cols-3 gap-2">
                {customThemes.map((ct) => {
                  const prev = THEME_PREVIEWS[ct.baseThemeId] ?? { bg: "#fff", surface: "#f0f0f0", text: "#000" };
                  return (
                    <PreviewCard
                      key={ct.id}
                      bg={prev.bg}
                      surface={prev.surface}
                      text={prev.text}
                      accent={ct.accentColor}
                      label={ct.name}
                      active={false}
                      onClick={() => applyCustomTheme(ct)}
                      onRemove={() => removeCustomTheme(ct.id)}
                    />
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default ThemeSwitcher;
