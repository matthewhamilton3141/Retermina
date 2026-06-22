/**
 * SettingsModal — the centralized, frosted-glass settings overlay.
 *
 * Replaces the old toolbar popovers (ThemeSwitcher + the gear dropdown) with a
 * single centered dialog organized into tabs: Theme, Appearance, Font, Version.
 * Every control writes straight to the persisted Zustand app store, so changes
 * survive restarts (the store is mirrored to settings.json by the persist
 * middleware).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";

import Icon, { type IconName } from "./Icon";
import { useTheme } from "../theme/ThemeProvider";
import { useAppStore, type ToolbarStyle, type TopBarStyle, type CustomFont } from "../store/app";
import type { ThemeId } from "../lib/theme";
import {
  FONTS,
  FONT_CATEGORIES,
  customFontStack,
} from "../lib/fonts";
import { registerCustomFont } from "../lib/fontRegistry";

// ── Shared data ──────────────────────────────────────────────────────────────

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

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: "theme",      label: "Theme",      icon: "palette" },
  { id: "appearance", label: "Appearance", icon: "layoutGrid" },
  { id: "font",       label: "Font",       icon: "font" },
  { id: "version",    label: "Version",    icon: "info" },
];

type TabId = "theme" | "appearance" | "font" | "version";

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

// ── Theme preview card (self-contained contrast) ─────────────────────────────

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
              <div className="h-1 w-3 bg-white opacity-80" style={{ borderRadius: lineRadius }} />
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
                <path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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

// ── Reusable radio group ─────────────────────────────────────────────────────

function RadioGroup<T extends string>({
  options, value, onChange,
}: {
  options: { style: T; label: string; desc: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {options.map(({ style, label, desc }) => {
        const active = value === style;
        return (
          <button
            key={style}
            type="button"
            onClick={() => onChange(style)}
            className={`rt-card flex w-full items-start gap-3 p-3 text-left ${active ? "rt-btn-active" : ""}`}
          >
            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
              active ? "border-[var(--rt-accent)] bg-[var(--rt-accent)]" : "border-[var(--rt-border)]"
            }`}>
              {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
            </span>
            <span>
              <span className="block text-sm font-medium">{label}</span>
              <span className="rt-text-faint block text-xs">{desc}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="rt-text-faint mb-2 text-[10px] font-semibold uppercase tracking-widest">
      {children}
    </p>
  );
}

// ── Theme tab ────────────────────────────────────────────────────────────────

function ThemeTab() {
  const { themeId, themes, setTheme } = useTheme();
  const customThemes      = useAppStore((s) => s.customThemes);
  const removeCustomTheme = useAppStore((s) => s.removeCustomTheme);
  const setThemeStore     = useAppStore((s) => s.setTheme);
  const accentColor       = useAppStore((s) => s.accentColor);
  const setAccentColor    = useAppStore((s) => s.setAccentColor);
  const saveCustomTheme   = useAppStore((s) => s.saveCustomTheme);

  const [presetName, setPresetName] = useState("");
  const [saving, setSaving]         = useState(false);
  const activeHex = accentColor ?? null;

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
    </div>
  );
}

// ── Appearance tab ───────────────────────────────────────────────────────────

const TOOLBAR_OPTIONS: { style: ToolbarStyle; label: string; desc: string }[] = [
  { style: "dropdown", label: "Panels dropdown", desc: "One button opens a panel checklist" },
  { style: "icons",    label: "Icon strip",      desc: "Individual icon buttons per panel" },
];

const TOPBAR_OPTIONS: { style: TopBarStyle; label: string; desc: string }[] = [
  { style: "icon-only",     label: "Icons only",     desc: "Compact — icons with tooltips" },
  { style: "icon-and-text", label: "Icons + labels", desc: "Spacious — icon beside text" },
];

function AppearanceTab() {
  const toolbarStyle    = useAppStore((s) => s.toolbarStyle);
  const setToolbarStyle = useAppStore((s) => s.setToolbarStyle);
  const topBarStyle     = useAppStore((s) => s.topBarStyle);
  const setTopBarStyle  = useAppStore((s) => s.setTopBarStyle);
  const uiScale         = useAppStore((s) => s.uiScale);
  const setUiScale      = useAppStore((s) => s.setUiScale);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle>Top bar labels</SectionTitle>
        <RadioGroup options={TOPBAR_OPTIONS} value={topBarStyle} onChange={setTopBarStyle} />
      </section>

      <section>
        <SectionTitle>Panel toggles</SectionTitle>
        <RadioGroup options={TOOLBAR_OPTIONS} value={toolbarStyle} onChange={setToolbarStyle} />
      </section>

      <section>
        <SectionTitle>Workspace text scale</SectionTitle>
        <div className="rt-card flex items-center gap-4 p-4">
          <input
            type="range"
            min={80}
            max={130}
            step={5}
            value={uiScale}
            onChange={(e) => setUiScale(Number(e.target.value))}
            className="flex-1 accent-[var(--rt-accent)]"
          />
          <span className="w-12 text-right text-sm font-medium tabular-nums">{uiScale}%</span>
          {uiScale !== 100 && (
            <button type="button" onClick={() => setUiScale(100)} className="rt-btn-outline px-2 py-1 text-xs">
              Reset
            </button>
          )}
        </div>
        <p className="rt-text-faint mt-2 text-xs">
          Scales every panel and toolbar across the whole workspace. Individual
          panels can still be fine-tuned with their own +/- controls.
        </p>
      </section>
    </div>
  );
}

// ── Font tab ─────────────────────────────────────────────────────────────────

/** Convert an ArrayBuffer to a base64 string in safe-sized chunks. */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

interface PendingUpload {
  fileName: string;
  base64: string;
  name: string;
  category: string;
}

function FontTab() {
  const fontId          = useAppStore((s) => s.fontId);
  const setFontId       = useAppStore((s) => s.setFontId);
  const customFonts     = useAppStore((s) => s.customFonts);
  const addCustomFont   = useAppStore((s) => s.addCustomFont);
  const removeCustomFont = useAppStore((s) => s.removeCustomFont);

  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".ttf") && !lower.endsWith(".otf")) {
      setError("Only .ttf and .otf files are supported.");
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buf);
      const baseName = file.name.replace(/\.(ttf|otf)$/i, "");
      setPending({ fileName: file.name, base64, name: baseName, category: "Uncategorized" });
    } catch {
      setError("Could not read that font file.");
    }
  };

  const confirmUpload = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      // Persist the bytes to disk and register the face for immediate use.
      const storedName = await invoke<string>("save_font", {
        fileName: pending.fileName,
        data: pending.base64,
      });
      const id = `cf-${Date.now()}`;
      const family = `rt-custom-${Date.now()}`;
      await registerCustomFont({ family, fileName: storedName }, pending.base64);
      const font: CustomFont = {
        id,
        name: pending.name.trim() || "Custom font",
        family,
        fileName: storedName,
        category: pending.category,
      };
      addCustomFont(font);
      setFontId(id);
      setPending(null);
    } catch (err) {
      setError(typeof err === "string" ? err : "Could not save the font.");
    } finally {
      setBusy(false);
    }
  };

  const renderFontRow = (
    id: string,
    name: string,
    description: string,
    stack: string | undefined,
    onRemove?: () => void,
  ) => {
    const active = fontId === id;
    return (
      <div key={id} className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setFontId(id)}
          className={`rt-card flex flex-1 items-center gap-3 p-3 text-left ${active ? "rt-btn-active" : ""}`}
        >
          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
            active ? "border-[var(--rt-accent)] bg-[var(--rt-accent)]" : "border-[var(--rt-border)]"
          }`}>
            {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium" style={stack ? { fontFamily: stack } : undefined}>{name}</span>
            <span className="rt-text-faint block truncate text-xs">{description}</span>
          </span>
          <span className="rt-text-faint text-base" style={stack ? { fontFamily: stack } : undefined}>Ag</span>
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Delete font"
            className="rt-btn rt-btn-danger flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
          >
            <Icon name="trash" size={14} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle>Built-in</SectionTitle>
        <div className="flex flex-col gap-2">
          {FONTS.map((f) => renderFontRow(f.id, f.name, f.description, f.stack ?? undefined))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>Your fonts</SectionTitle>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rt-btn-outline flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium"
          >
            <Icon name="export" size={13} /> Upload .ttf / .otf
          </button>
          <input ref={fileRef} type="file" accept=".ttf,.otf" className="hidden" onChange={onPick} />
        </div>

        {error && <p className="mb-2 text-xs text-red-500">{error}</p>}

        {/* Pending upload — name + category before commit */}
        {pending && (
          <div className="rt-card mb-3 flex flex-col gap-3 p-3">
            <p className="text-xs font-medium">New font · <span className="rt-text-faint font-mono">{pending.fileName}</span></p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={pending.name}
                onChange={(e) => setPending({ ...pending, name: e.target.value })}
                placeholder="Display name"
                className="rt-input flex-1 px-2 py-1.5 text-sm"
              />
              <select
                value={pending.category}
                onChange={(e) => setPending({ ...pending, category: e.target.value })}
                className="rt-input px-2 py-1.5 text-sm"
              >
                {FONT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" disabled={busy} onClick={confirmUpload} className="rt-btn-outline rt-btn-active px-3 py-1.5 text-sm disabled:opacity-50">
                {busy ? "Saving…" : "Add font"}
              </button>
              <button type="button" disabled={busy} onClick={() => setPending(null)} className="rt-btn px-2 py-1.5 text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}

        {customFonts.length === 0 && !pending ? (
          <div className="rt-empty p-4 text-center">
            <p className="rt-text-faint text-xs">
              No uploaded fonts yet. Upload a <span className="font-mono">.ttf</span> or
              {" "}<span className="font-mono">.otf</span> to use a custom typeface.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {customFonts.map((f) =>
              renderFontRow(
                f.id,
                f.name,
                f.category,
                customFontStack(f.family),
                () => removeCustomFont(f.id),
              ),
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Version tab ──────────────────────────────────────────────────────────────

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "uptodate" }
  | { kind: "available"; version: string; notes?: string }
  | { kind: "downloading"; pct: number }
  | { kind: "ready" }
  | { kind: "error"; message: string };

function VersionTab() {
  const [version, setVersion] = useState<string>("…");
  const [state, setState]     = useState<UpdateState>({ kind: "idle" });
  // Hold the resolved Update object between "check" and "install".
  const updateRef = useRef<{ version: string; downloadAndInstall: (cb: (e: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => Promise<void> } | null>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("unknown"));
  }, []);

  const checkForUpdates = async () => {
    setState({ kind: "checking" });
    updateRef.current = null;
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        updateRef.current = update as never;
        setState({ kind: "available", version: update.version, notes: update.body });
      } else {
        setState({ kind: "uptodate" });
      }
    } catch (err) {
      setState({
        kind: "error",
        message:
          "Could not reach the update server. This build may not have an update channel configured yet.",
      });
      console.error("Update check failed:", err);
    }
  };

  const installUpdate = async () => {
    const update = updateRef.current;
    if (!update) return;
    try {
      let total = 0;
      let received = 0;
      setState({ kind: "downloading", pct: 0 });
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data?.contentLength ?? 0;
        else if (event.event === "Progress") {
          received += event.data?.chunkLength ?? 0;
          const pct = total > 0 ? Math.round((received / total) * 100) : 0;
          setState({ kind: "downloading", pct });
        } else if (event.event === "Finished") setState({ kind: "ready" });
      });
      setState({ kind: "ready" });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      setState({ kind: "error", message: "The update could not be installed." });
      console.error("Update install failed:", err);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="rt-card flex items-center gap-4 p-5">
        <div className="rt-card-icon flex h-12 w-12 items-center justify-center rounded-xl">
          <Icon name="terminal" size={24} className="rt-accent-text" />
        </div>
        <div className="min-w-0">
          <p className="text-base font-semibold">Retermina</p>
          <p className="rt-text-faint text-sm">Version <span className="font-mono">{version}</span></p>
        </div>
      </section>

      <section>
        <SectionTitle>Updates</SectionTitle>
        <div className="rt-card flex flex-col gap-3 p-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={checkForUpdates}
              disabled={state.kind === "checking" || state.kind === "downloading"}
              className="rt-btn-outline flex items-center gap-2 px-3 py-1.5 text-sm disabled:opacity-50"
            >
              <Icon name="sync" size={14} className={state.kind === "checking" ? "animate-spin" : ""} />
              {state.kind === "checking" ? "Checking…" : "Check for Updates"}
            </button>

            {state.kind === "available" && (
              <button type="button" onClick={installUpdate} className="rt-btn-outline rt-btn-active flex items-center gap-2 px-3 py-1.5 text-sm">
                <Icon name="apply" size={14} /> Download & Install {state.version}
              </button>
            )}
          </div>

          {state.kind === "uptodate" && (
            <p className="text-sm text-[var(--rt-accent)]">You're on the latest version.</p>
          )}
          {state.kind === "available" && state.notes && (
            <p className="rt-text-faint whitespace-pre-line text-xs">{state.notes}</p>
          )}
          {state.kind === "downloading" && (
            <div className="flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--rt-surface-hover)]">
                <div className="h-full rounded-full bg-[var(--rt-accent)] transition-all" style={{ width: `${state.pct}%` }} />
              </div>
              <span className="text-xs tabular-nums">{state.pct}%</span>
            </div>
          )}
          {state.kind === "ready" && (
            <p className="text-sm text-[var(--rt-accent)]">Update installed — relaunching…</p>
          )}
          {state.kind === "error" && (
            <p className="rt-text-faint text-xs">{state.message}</p>
          )}
        </div>
      </section>

      <p className="rt-text-faint text-center text-xs">
        Retermina · Built with Tauri, React &amp; xterm.js
      </p>
    </div>
  );
}

// ── Modal shell ──────────────────────────────────────────────────────────────

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState<TabId>("theme");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const content = useMemo(() => {
    switch (tab) {
      case "theme":      return <ThemeTab />;
      case "appearance": return <AppearanceTab />;
      case "font":       return <FontTab />;
      case "version":    return <VersionTab />;
    }
  }, [tab]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div className="rt-card flex h-[34rem] max-h-[88vh] w-full max-w-3xl overflow-hidden shadow-2xl">
        {/* Tab rail */}
        <nav className="flex w-44 shrink-0 flex-col gap-1 border-r border-[var(--rt-border)] bg-[var(--rt-surface-strong)] p-3">
          <p className="rt-text-faint mb-2 px-2 text-sm font-semibold">Settings</p>
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rt-menu-item flex items-center gap-2.5 px-3 py-2 text-left text-sm ${active ? "rt-btn-active" : ""}`}
              >
                <Icon name={t.icon} size={15} />
                <span className="font-medium">{t.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Tab body */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-[var(--rt-border)] px-5 py-3">
            <h2 className="text-sm font-semibold capitalize">{tab}</h2>
            <button type="button" onClick={onClose} title="Close settings" className="rt-btn flex h-7 w-7 items-center justify-center">
              <Icon name="close" size={15} />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {content}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
