/**
 * Global theme provider.
 *
 * The provider is the bridge between persisted app state and the DOM: it writes
 * the active engine id to `document.documentElement[data-theme]`, which is what
 * the CSS custom-property blocks in `src/index.css` key off of. Because the look
 * is driven entirely by that one attribute, switching engines re-skins the whole
 * app without re-rendering React — the memoized live terminal panel keeps its
 * PTY binding across a theme change.
 *
 * It also exposes, via `useTheme`, the few values that JavaScript still needs:
 * the xterm color table for the active engine (the terminal canvas is painted,
 * not CSS-styled) and the engine list/selector used by the theme switcher.
 */
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ITheme } from "@xterm/xterm";

import { useAppStore } from "../store/app";
import {
  DEFAULT_THEME_ID,
  THEMES,
  claudeThemeForEngine,
  resolveTheme,
  type ThemeId,
  type ThemeMeta,
} from "../lib/theme";
import { FONT_BY_ID, customFontStack } from "../lib/fonts";
import { registerAllCustomFonts } from "../lib/fontRegistry";
import { setClaudeTheme } from "../lib/fs";

export interface ThemeContextValue {
  /** The active engine id. */
  themeId: ThemeId;
  /** Full metadata for the active engine. */
  theme: ThemeMeta;
  /** All selectable engines, in display order. */
  themes: readonly ThemeMeta[];
  /** xterm color table for the active engine. */
  terminalTheme: ITheme;
  /** Switch the active engine (persisted). */
  setTheme: (id: ThemeId) => void;
}

const fallback = resolveTheme(DEFAULT_THEME_ID);

/**
 * Default value mirrors the fallback engine so a stray `useTheme()` outside the
 * provider degrades gracefully instead of throwing. In practice the provider
 * wraps the whole app.
 */
const ThemeContext = createContext<ThemeContextValue>({
  themeId: fallback.id,
  theme: fallback,
  themes: THEMES,
  terminalTheme: fallback.terminal,
  setTheme: () => {},
});

/**
 * Resolve a CSS custom property that holds a colour (possibly a `color-mix()`
 * or `var()` expression) to a concrete `rgb(...)` string. Custom properties
 * aren't computed to a resolved colour on their own, so we read it back through
 * a throwaway element's `background-color`, which the engine *does* resolve.
 * Returns null if it resolves to transparent (i.e. the var isn't set).
 */
function resolveCssColor(varName: string): string | null {
  const probe = document.createElement("div");
  probe.style.cssText = `position:absolute;visibility:hidden;background-color:var(${varName})`;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).backgroundColor;
  probe.remove();
  if (!computed || computed === "rgba(0, 0, 0, 0)" || computed === "transparent") return null;

  // `color-mix()` resolves to CSS Color 4 `color(srgb …)`, which xterm's parser
  // doesn't accept. Normalize any valid colour string to `#rrggbb` via a 1×1
  // canvas, which xterm always understands.
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return computed;
  ctx.fillStyle = computed;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Convert a 6-digit hex colour to an rgba() string. */
function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8)  & 255;
  const b =  n        & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** WCAG relative luminance of a 6-digit hex colour (0 = black, 1 = white). */
function relativeLuminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const chan = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = chan((n >> 16) & 255);
  const g = chan((n >> 8)  & 255);
  const b = chan( n        & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Pick the text colour (near-black or white) with the better contrast ratio
 * against `hex`. This keeps text legible on top of any accent — without it, a
 * light accent like white turns selection highlights into blank blocks.
 */
function accentContrast(hex: string): string {
  const L = relativeLuminance(hex);
  const contrastWhite = 1.05 / (L + 0.05);
  const contrastBlack = (L + 0.05) / 0.05;
  return contrastWhite >= contrastBlack ? "#ffffff" : "#0a0a0a";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const themeId     = useAppStore((state) => state.themeId);
  const setTheme    = useAppStore((state) => state.setTheme);
  const accentColor = useAppStore((state) => state.accentColor);
  const fontId      = useAppStore((state) => state.fontId);
  const uiScale     = useAppStore((state) => state.uiScale);
  const customFonts = useAppStore((state) => state.customFonts);

  // The engine's CSS terminal surface, resolved to a concrete colour. Kept in
  // state because it can't be derived from JS alone — for engines like Pastel
  // it's `color-mix(--rt-accent …)`, so it depends on the live accent and must
  // be read back from the cascade after the theme/accent are applied below.
  const [terminalBg, setTerminalBg] = useState<string | null>(null);

  // Tolerate an unknown persisted id by resolving to the default engine.
  const theme = resolveTheme(themeId);

  // Register every uploaded font with the document so a persisted `fontId`
  // pointing at a custom family actually resolves after a restart.
  useEffect(() => {
    if (customFonts.length) void registerAllCustomFonts(customFonts);
  }, [customFonts]);

  // Keep Claude Code's persisted UI theme in step with the active engine so the
  // embedded Claude Code panel doesn't render a dark UI on a light workspace (or
  // vice versa). Best-effort and fire-and-forget — the change is picked up by
  // the next `claude` launch, not a running session. Errors (e.g. running
  // outside Tauri, or no Claude config yet) are swallowed.
  useEffect(() => {
    void setClaudeTheme(claudeThemeForEngine(theme)).catch(() => {});
  }, [theme]);

  // Apply the data-theme attribute and optional accent override before paint.
  useLayoutEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = theme.id;

    if (accentColor && /^#[0-9a-fA-F]{6}$/.test(accentColor)) {
      el.style.setProperty("--rt-accent",            accentColor);
      el.style.setProperty("--rt-accent-soft",       hexToRgba(accentColor, 0.12));
      el.style.setProperty("--rt-ring",              hexToRgba(accentColor, 0.5));
      el.style.setProperty("--rt-grid-placeholder",  accentColor);
      // Contrast-aware text colour for anything placed ON the accent (text
      // selection, checkmarks, dots) so a light accent never hides content.
      el.style.setProperty("--rt-accent-contrast",   accentContrast(accentColor));
    } else {
      el.style.removeProperty("--rt-accent");
      el.style.removeProperty("--rt-accent-soft");
      el.style.removeProperty("--rt-ring");
      el.style.removeProperty("--rt-grid-placeholder");
      el.style.removeProperty("--rt-accent-contrast");
    }

    // Font family override — built-in stack, or an uploaded custom family.
    const builtIn = FONT_BY_ID[fontId];
    const custom  = customFonts.find((f) => f.id === fontId);
    const stack   = builtIn?.stack ?? (custom ? customFontStack(custom.family) : null);
    if (stack) {
      el.style.setProperty("--rt-font-sans", stack);
    } else {
      el.style.removeProperty("--rt-font-sans");
    }

    // Global workspace text scale: driving the root font-size scales every
    // rem-based Tailwind utility across the app in one stroke (100% → 16px).
    if (uiScale !== 100) {
      el.style.fontSize = `${(uiScale / 100) * 16}px`;
    } else {
      el.style.removeProperty("font-size");
    }

    // Now that data-theme + accent are applied, read the engine's resolved
    // terminal surface so the xterm canvas can paint with the exact same colour
    // as its panel (and pick up accent-derived tints, e.g. Pastel/Glass).
    setTerminalBg(resolveCssColor("--rt-terminal-bg"));
  }, [theme.id, accentColor, fontId, customFonts, uiScale]);

  // Overlay accent-dependent terminal colours so the terminal and the Claude
  // Code panel track the live accent choice.
  //
  // cursor + selection always follow the accent (the selection is a SOLID
  // accent fill with contrast-aware text, mirroring the web `::selection` look
  // in index.css so a highlight reads identically in the Terminal and Code).
  //
  // When the user picks a CUSTOM accent we additionally retint the ANSI
  // "accent-hue" slots — blue and magenta, normal + bright. Terminal UIs,
  // including the embedded Claude Code CLI, draw their primary/brand accent
  // from these slots, so without this a blue accent still shows the engine's
  // default violet (e.g. Sleek's magenta `#c084fc`). Red / green / yellow /
  // cyan are deliberately left alone so errors, success, warnings, and info
  // keep their conventional meaning. With no custom accent we leave the
  // engine's hand-tuned palette exactly as authored.
  const terminalTheme = useMemo<ITheme>(() => {
    const hasCustomAccent = !!accentColor && /^#[0-9a-fA-F]{6}$/.test(accentColor);
    const accent = hasCustomAccent ? accentColor! : theme.accentColor;

    // Paint the canvas with the engine's CSS terminal surface so it matches the
    // panel exactly (and follows accent-derived tints). cursorAccent — the
    // glyph under a block cursor — tracks the background so it stays legible.
    const background = terminalBg ?? theme.terminal.background;

    const overrides: Partial<ITheme> = {
      background,
      cursorAccent:        background,
      cursor:              accent,
      selectionBackground: accent,
      // Contrast-aware so a light accent (e.g. white) doesn't render the
      // highlighted text as an unreadable solid block.
      selectionForeground: accentContrast(accent),
      selectionInactiveBackground: hexToRgba(accent, 0.45),
    };

    if (hasCustomAccent) {
      overrides.blue          = accent;
      overrides.brightBlue    = accent;
      overrides.magenta       = accent;
      overrides.brightMagenta = accent;
    }

    return { ...theme.terminal, ...overrides };
  }, [theme, accentColor, terminalBg]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeId: theme.id,
      theme,
      themes: THEMES,
      terminalTheme,
      setTheme,
    }),
    [theme, terminalTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/** Read the active theme and the engine selector. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export default ThemeProvider;
