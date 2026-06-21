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
  label: string;
  active: boolean;
  isBrutalism?: boolean;
  onClick: () => void;
  onRemove?: () => void;
}

/**
 * All accent-coloured elements use `var(--rt-accent)` so they update live
 * whenever the user picks a new accent colour — no prop threading required.
 * Each card still shows its own theme's background / surface / text palette.
 */
function PreviewCard({
  bg, surface, text, label, active, isBrutalism = false, onClick, onRemove,
}: PreviewCardProps) {
  // Brutalism: zero radius, thick black outline, hard drop-shadow
  const cardRadius  = isBrutalism ? "0px"   : "8px";
  const innerRadius = isBrutalism ? "0px"   : "4px";
  const dotRadius   = isBrutalism ? "0px"   : "9999px";
  const lineRadius  = isBrutalism ? "0px"   : "9999px";
  const border      = isBrutalism ? "2px solid #000" : "none";
  const cardShadow  = isBrutalism ? "4px 4px 0 0 #000000" : "none";
  const activeShadow = isBrutalism ? "4px 4px 0 0 #000000" : "none";
  const hoverClass  = isBrutalism ? "hover:-translate-y-0.5 hover:-translate-x-0.5" : "hover:scale-105";

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onClick}
        className={`w-full overflow-hidden transition-transform ${hoverClass}`}
        style={{
          borderRadius: cardRadius,
          border: active ? "2px solid var(--rt-accent)" : border,
          boxShadow: active ? (isBrutalism ? activeShadow : "0 0 0 2px var(--rt-accent)") : cardShadow,
          outline: "none",
        }}
      >
        {/* Mini mockup */}
        <div className="h-14 w-full relative" style={{ backgroundColor: bg }}>
          {/* Fake panel */}
          <div
            className="absolute inset-x-1.5 top-1.5 bottom-1.5"
            style={{
              backgroundColor: surface,
              borderRadius: innerRadius,
              border: isBrutalism ? "1.5px solid #000" : "none",
            }}
          >
            {/* Fake title bar */}
            <div
              className="flex items-center gap-1 px-1.5 py-1"
              style={{ borderBottom: isBrutalism ? "1.5px solid #000" : `1px solid ${text}18` }}
            >
              {/* Accent dot / square */}
              <div
                className="h-1.5 w-1.5 shrink-0"
                style={{ backgroundColor: "var(--rt-accent)", borderRadius: dotRadius }}
              />
              <div
                className="h-1 flex-1"
                style={{ backgroundColor: text, opacity: 0.2, borderRadius: lineRadius }}
              />
            </div>

            {/* Fake content lines */}
            <div className="px-1.5 pt-1 flex flex-col gap-0.5">
              <div
                className="h-1 w-3/4"
                style={{ backgroundColor: text, opacity: 0.15, borderRadius: lineRadius }}
              />
              <div
                className="h-1 w-1/2"
                style={{ backgroundColor: text, opacity: 0.1, borderRadius: lineRadius }}
              />
              {isBrutalism && (
                /* Extra progress-bar-style element to show the industrial aesthetic */
                <div className="h-1 w-full mt-0.5" style={{ backgroundColor: text, opacity: 0.06 }}>
                  <div className="h-full w-2/3" style={{ backgroundColor: "var(--rt-accent)" }} />
                </div>
              )}
            </div>

            {/* Fake accent button */}
            <div
              className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5"
              style={{
                backgroundColor: "var(--rt-accent)",
                borderRadius: innerRadius,
                border: isBrutalism ? "1.5px solid #000" : "none",
                boxShadow: isBrutalism ? "2px 2px 0 0 #000" : "none",
              }}
            >
              <div
                className="h-1 w-3 bg-white opacity-80"
                style={{ borderRadius: lineRadius }}
              />
            </div>
          </div>

          {/* Active checkmark */}
          {active && (
            <div
              className="absolute top-1 right-1 flex h-3.5 w-3.5 items-center justify-center"
              style={{
                backgroundColor: "var(--rt-accent)",
                borderRadius: dotRadius,
                border: isBrutalism ? "1.5px solid #000" : "none",
              }}
            >
              <svg viewBox="0 0 8 8" fill="none" className="h-2 w-2">
                <path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </div>

        {/* Label */}
        <div
          className="py-1 text-center text-[10px] font-medium truncate px-1"
          style={{
            backgroundColor: isBrutalism ? "#fafaf5" : "transparent",
            color: text,
            borderTop: isBrutalism ? "1.5px solid #000" : "none",
            fontWeight: isBrutalism ? 700 : undefined,
          }}
        >
          {label}
        </div>
      </button>

      {/* Remove button for custom presets */}
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

// ── Colour specs used ONLY for background / surface / text (not accent) ──────

const THEME_PREVIEWS: Record<string, { bg: string; surface: string; text: string }> = {
  sleek:      { bg: "#0a0a0a", surface: "#171717", text: "#f5f5f5" },
  pastel:     { bg: "#f6f4fb", surface: "#ffffff", text: "#4c4361" },
  glass:      { bg: "#dde0e8", surface: "#f5f6f8", text: "#1c1e21" },
  minimalist: { bg: "#ffffff", surface: "#fafafa", text: "#18181b" },
  brutalism:  { bg: "#fafaf5", surface: "#ffffff", text: "#0a0a0a" },
};

// ── Component ────────────────────────────────────────────────────────────────

export function ThemeSwitcher({ className, align = "right" }: ThemeSwitcherProps) {
  const { themeId, themes, setTheme } = useTheme();
  const customThemes      = useAppStore((s) => s.customThemes);
  const removeCustomTheme = useAppStore((s) => s.removeCustomTheme);
  const setThemeStore     = useAppStore((s) => s.setTheme);
  const setAccentColor    = useAppStore((s) => s.setAccentColor);

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
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const applyCustomTheme = (ct: (typeof customThemes)[number]) => {
    setThemeStore(ct.baseThemeId);
    setAccentColor(ct.accentColor);
    setOpen(false);
  };

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      {/* Trigger — live accent dot uses var(--rt-accent) so it tracks instantly */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Change theme"
        className="rt-btn-outline flex items-center gap-1.5 px-2 py-1 text-xs font-medium"
      >
        <Icon name="palette" size={14} />
        <span
          className="hidden sm:inline h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: "var(--rt-accent)" }}
        />
        <Icon name="chevronDown" size={11} />
      </button>

      {open && (
        <div
          className={`rt-menu absolute z-50 mt-2 w-72 p-3 ${align === "right" ? "right-0" : "left-0"}`}
        >
          <p className="rt-text-faint mb-2 text-[10px] font-semibold uppercase tracking-widest">
            Themes
          </p>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {themes.map((engine) => {
              const prev = THEME_PREVIEWS[engine.id] ?? { bg: "#fff", surface: "#f0f0f0", text: "#000" };
              const isActive = engine.id === themeId;
              return (
                <PreviewCard
                  key={engine.id}
                  bg={prev.bg}
                  surface={prev.surface}
                  text={prev.text}
                  label={engine.label}
                  active={isActive}
                  isBrutalism={engine.id === "brutalism"}
                  onClick={() => { setTheme(engine.id as ThemeId); setOpen(false); }}
                />
              );
            })}
          </div>

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
                      label={ct.name}
                      active={false}
                      isBrutalism={ct.baseThemeId === "brutalism"}
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
