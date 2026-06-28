/** Settings ▸ Theme — engine picker, accent colour, presets, font pairing. */
import { useState } from "react";

import Icon from "../Icon";
import LoomManager from "../LoomManager";
import { SectionTitle, Switch } from "./primitives";
import { useTheme } from "../../theme/ThemeProvider";
import { useAppStore, type CustomFont } from "../../store/app";
import type { ThemeId } from "../../lib/theme";
import { FONTS, THEME_FONT_CATEGORY, fontIdForCategory } from "../../lib/fonts";

/** Resolve a font id (built-in or uploaded) to its display name. */
function fontLabel(id: string, customFonts: readonly CustomFont[]): string {
  const builtIn = FONTS.find((f) => f.id === id);
  if (builtIn) return builtIn.name;
  return customFonts.find((f) => f.id === id)?.name ?? "Font";
}

const ACCENT_PRESETS: { name: string; hex: string }[] = [
  { name: "Emerald", hex: "#10b981" },
  { name: "Violet",  hex: "#8b5cf6" },
  { name: "Blue",    hex: "#3b82f6" },
  { name: "Rose",    hex: "#f43f5e" },
  { name: "Amber",   hex: "#f59e0b" },
  { name: "Cyan",    hex: "#06b6d4" },
  { name: "Orange",  hex: "#f97316" },
  { name: "Indigo",  hex: "#6366f1" },
];

/**
 * Per-theme background / surface / text swatches used to paint the preview
 * cards. These are independent of the globally active theme so each card always
 * renders in its OWN palette — that is what keeps a dark card's text light
 * (and legible) even when the app is currently in a light theme, and vice versa.
 */
const THEME_PREVIEWS: Record<string, { bg: string; surface: string; text: string }> = {
  sleek:      { bg: "#0a0a0a", surface: "#171717", text: "#f5f5f5" },
  pastel:     { bg: "#f6f4fb", surface: "#ffffff", text: "#4c4361" },
  glass:      { bg: "#dde0e8", surface: "#f5f6f8", text: "#1c1e21" },
  minimalist: { bg: "#ffffff", surface: "#fafafa", text: "#18181b" },
  brutalism:  { bg: "#fafaf5", surface: "#ffffff", text: "#0a0a0a" },
};

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

function PreviewCard({
  bg, surface, text, label, active, isBrutalism = false, onClick, onRemove,
}: PreviewCardProps) {
  const cardRadius  = isBrutalism ? "0px" : "8px";
  const innerRadius = isBrutalism ? "0px" : "4px";
  const dotRadius   = isBrutalism ? "0px" : "9999px";
  const lineRadius  = isBrutalism ? "0px" : "9999px";
  const border      = isBrutalism ? "2px solid #000" : "1px solid rgba(127,127,127,0.18)";
  const cardShadow  = isBrutalism ? "4px 4px 0 0 #000000" : "none";
  const hoverClass  = isBrutalism ? "hover:-translate-y-0.5 hover:-translate-x-0.5" : "hover:scale-[1.03]";

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onClick}
        className={`w-full overflow-hidden transition-transform ${hoverClass}`}
        style={{
          borderRadius: cardRadius,
          border: active ? "2px solid var(--rt-accent)" : border,
          boxShadow: active ? (isBrutalism ? cardShadow : "0 0 0 2px var(--rt-accent)") : cardShadow,
          outline: "none",
        }}
      >
        {/* Mini mockup, painted in THIS card's own palette. */}
        <div className="h-16 w-full relative" style={{ backgroundColor: bg }}>
          <div
            className="absolute inset-x-2 top-2 bottom-2"
            style={{
              backgroundColor: surface,
              borderRadius: innerRadius,
              border: isBrutalism ? "1.5px solid #000" : "none",
            }}
          >
            <div
              className="flex items-center gap-1 px-1.5 py-1"
              style={{ borderBottom: isBrutalism ? "1.5px solid #000" : `1px solid ${text}18` }}
            >
              <div
                className="h-1.5 w-1.5 shrink-0"
                style={{ backgroundColor: "var(--rt-accent)", borderRadius: dotRadius }}
              />
              <div className="h-1 flex-1" style={{ backgroundColor: text, opacity: 0.2, borderRadius: lineRadius }} />
            </div>
            <div className="px-1.5 pt-1 flex flex-col gap-0.5">
              <div className="h-1 w-3/4" style={{ backgroundColor: text, opacity: 0.16, borderRadius: lineRadius }} />
              <div className="h-1 w-1/2" style={{ backgroundColor: text, opacity: 0.1, borderRadius: lineRadius }} />
            </div>
            <div
              className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5"
              style={{
                backgroundColor: "var(--rt-accent)",
                borderRadius: innerRadius,
                border: isBrutalism ? "1.5px solid #000" : "none",
                boxShadow: isBrutalism ? "2px 2px 0 0 #000" : "none",
              }}
            >
              <div className="h-1 w-3 opacity-80" style={{ borderRadius: lineRadius, backgroundColor: "var(--rt-accent-contrast, #fff)" }} />
            </div>
          </div>

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
                <path d="M1 4l2 2 4-4" style={{ stroke: "var(--rt-accent-contrast, #fff)" }} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </div>

        {/* Label sits on the card's own bg with the card's own text colour, so
            it always contrasts regardless of the globally active theme. */}
        <div
          className="py-1 text-center text-[10px] font-medium truncate px-1"
          style={{
            backgroundColor: bg,
            color: text,
            borderTop: isBrutalism ? "1.5px solid #000" : `1px solid ${text}14`,
            fontWeight: isBrutalism ? 700 : undefined,
          }}
        >
          {label}
        </div>
      </button>

      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute -top-1.5 -right-1.5 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white shadow"
          title="Remove preset"
        >
          <Icon name="close" size={9} />
        </button>
      )}
    </div>
  );
}

export default function ThemeTab() {
  const { themeId, themes, setTheme } = useTheme();
  const customThemes      = useAppStore((s) => s.customThemes);
  const removeCustomTheme = useAppStore((s) => s.removeCustomTheme);
  const setThemeStore     = useAppStore((s) => s.setTheme);
  const accentColor       = useAppStore((s) => s.accentColor);
  const setAccentColor    = useAppStore((s) => s.setAccentColor);
  const saveCustomTheme   = useAppStore((s) => s.saveCustomTheme);
  const customFonts       = useAppStore((s) => s.customFonts);
  const fontId            = useAppStore((s) => s.fontId);
  const setFontId         = useAppStore((s) => s.setFontId);
  const autoPairFont      = useAppStore((s) => s.autoPairFont);
  const setAutoPairFont   = useAppStore((s) => s.setAutoPairFont);

  const [presetName, setPresetName] = useState("");
  const [saving, setSaving]         = useState(false);
  const activeHex = accentColor ?? null;

  // Font pairing — the category that "belongs to" this theme, and the best
  // matching font for it (uploaded fonts win over built-ins).
  const pairCategory = THEME_FONT_CATEGORY[themeId];
  const suggestedId  = pairCategory ? fontIdForCategory(pairCategory, customFonts) : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Built-in themes */}
      <section>
        <SectionTitle>Theme</SectionTitle>
        <div className="grid grid-cols-3 gap-3">
          {themes.map((engine) => {
            const prev = THEME_PREVIEWS[engine.id] ?? { bg: "#fff", surface: "#f0f0f0", text: "#000" };
            return (
              <PreviewCard
                key={engine.id}
                {...prev}
                label={engine.label}
                active={engine.id === themeId}
                isBrutalism={engine.id === "brutalism"}
                onClick={() => setTheme(engine.id as ThemeId)}
              />
            );
          })}
        </div>
      </section>

      {/* Custom presets */}
      {customThemes.length > 0 && (
        <section>
          <SectionTitle>My Presets</SectionTitle>
          <div className="grid grid-cols-3 gap-3">
            {customThemes.map((ct) => {
              const prev = THEME_PREVIEWS[ct.baseThemeId] ?? { bg: "#fff", surface: "#f0f0f0", text: "#000" };
              return (
                <PreviewCard
                  key={ct.id}
                  {...prev}
                  label={ct.name}
                  active={false}
                  isBrutalism={ct.baseThemeId === "brutalism"}
                  onClick={() => { setThemeStore(ct.baseThemeId); setAccentColor(ct.accentColor); }}
                  onRemove={() => removeCustomTheme(ct.id)}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Accent colour */}
      <section>
        <SectionTitle>Accent colour</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          {ACCENT_PRESETS.map(({ name, hex }) => {
            const active = activeHex === hex;
            return (
              <button
                key={hex}
                type="button"
                title={name}
                onClick={() => setAccentColor(hex)}
                className="relative flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-110"
                style={{ backgroundColor: hex }}
              >
                {active && <span className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white ring-offset-2 ring-offset-transparent" />}
              </button>
            );
          })}

          {/* Custom colour picker */}
          <label
            title="Custom colour"
            className="relative flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-[var(--rt-border)]"
            style={activeHex && !ACCENT_PRESETS.some((p) => p.hex === activeHex)
              ? { backgroundColor: activeHex }
              : { background: "conic-gradient(red,yellow,lime,cyan,blue,magenta,red)" }}
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
            className="rt-input w-24 px-2 py-1 font-mono text-xs"
            maxLength={7}
          />

          {activeHex && (
            <button
              type="button"
              onClick={() => setAccentColor(null)}
              className="rt-btn-outline flex items-center gap-1 px-2 py-1 text-xs"
              title="Revert to the theme's default accent"
            >
              <Icon name="sync" size={12} /> Default
            </button>
          )}
        </div>
      </section>

      {/* Save as preset */}
      <section>
        {saving ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && presetName.trim()) { saveCustomTheme(presetName.trim()); setPresetName(""); setSaving(false); }
                if (e.key === "Escape") { setPresetName(""); setSaving(false); }
              }}
              placeholder="Preset name…"
              className="rt-input flex-1 px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              disabled={!presetName.trim()}
              onClick={() => { saveCustomTheme(presetName.trim()); setPresetName(""); setSaving(false); }}
              className="rt-btn-outline px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Save
            </button>
            <button type="button" onClick={() => { setPresetName(""); setSaving(false); }} className="rt-btn px-2 py-1.5 text-sm">
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSaving(true)}
            className="rt-btn-outline flex items-center gap-2 px-3 py-1.5 text-sm"
          >
            <Icon name="plus" size={13} />
            Save current theme + accent as preset
          </button>
        )}
      </section>

      {/* Font pairing (#1 suggest-on-switch + #3 auto-pair toggle) */}
      <section>
        <SectionTitle>Font pairing</SectionTitle>
        <div className="rt-card flex flex-col gap-3 p-3">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-medium">Match font to theme</span>
              <span className="rt-text-faint block text-xs">
                Switching themes also picks the font categorized for it.
              </span>
            </span>
            <Switch checked={autoPairFont} onChange={setAutoPairFont} />
          </label>

          {pairCategory && suggestedId ? (
            <div className="flex items-center justify-between gap-3 border-t border-[var(--rt-border)] pt-3">
              <span className="min-w-0 text-xs">
                <span className="rt-text-faint">Suggested: </span>
                <span className="font-medium">{fontLabel(suggestedId, customFonts)}</span>
                <span className="rt-text-faint"> · {pairCategory}</span>
              </span>
              {fontId === suggestedId ? (
                <span className="shrink-0 text-xs text-[var(--rt-accent)]">Applied</span>
              ) : (
                <button
                  type="button"
                  onClick={() => setFontId(suggestedId)}
                  className="rt-btn-outline shrink-0 px-2.5 py-1 text-xs"
                >
                  Apply
                </button>
              )}
            </div>
          ) : (
            <p className="rt-text-faint border-t border-[var(--rt-border)] pt-3 text-xs">
              This theme has no signature font — choose any in the Font tab.
            </p>
          )}
        </div>
      </section>

      {/* Retermina Loom — preset management (save / apply / export / import) */}
      <section>
        <SectionTitle>Retermina Loom</SectionTitle>
        <LoomManager />
      </section>
    </div>
  );
}
