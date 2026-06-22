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
  type ReactNode,
} from "react";
import type { ITheme } from "@xterm/xterm";

import { useAppStore } from "../store/app";
import {
  DEFAULT_THEME_ID,
  THEMES,
  resolveTheme,
  type ThemeId,
  type ThemeMeta,
} from "../lib/theme";
import { FONT_BY_ID, customFontStack } from "../lib/fonts";
import { registerAllCustomFonts } from "../lib/fontRegistry";

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

/** Convert a 6-digit hex colour to an rgba() string. */
function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8)  & 255;
  const b =  n        & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const themeId     = useAppStore((state) => state.themeId);
  const setTheme    = useAppStore((state) => state.setTheme);
  const accentColor = useAppStore((state) => state.accentColor);
  const fontId      = useAppStore((state) => state.fontId);
  const uiScale     = useAppStore((state) => state.uiScale);
  const customFonts = useAppStore((state) => state.customFonts);

  // Tolerate an unknown persisted id by resolving to the default engine.
  const theme = resolveTheme(themeId);

  // Register every uploaded font with the document so a persisted `fontId`
  // pointing at a custom family actually resolves after a restart.
  useEffect(() => {
    if (customFonts.length) void registerAllCustomFonts(customFonts);
  }, [customFonts]);

  // Apply the data-theme attribute and optional accent override before paint.
  useLayoutEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = theme.id;

    if (accentColor && /^#[0-9a-fA-F]{6}$/.test(accentColor)) {
      el.style.setProperty("--rt-accent",            accentColor);
      el.style.setProperty("--rt-accent-soft",       hexToRgba(accentColor, 0.12));
      el.style.setProperty("--rt-ring",              hexToRgba(accentColor, 0.5));
      el.style.setProperty("--rt-grid-placeholder",  accentColor);
    } else {
      el.style.removeProperty("--rt-accent");
      el.style.removeProperty("--rt-accent-soft");
      el.style.removeProperty("--rt-ring");
      el.style.removeProperty("--rt-grid-placeholder");
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
  }, [theme.id, accentColor, fontId, customFonts, uiScale]);

  // Overlay accent-dependent terminal colours so cursor + selection track the
  // live accent choice. Only cursor and selection are overridden — the ANSI
  // colour palette slots (red, blue, green, …) are left untouched because
  // terminal apps like Claude Code use them for their own UI colours.
  //
  // The selection is painted as a SOLID accent fill with white text to mirror
  // the web `::selection` look (see index.css), so a highlight inside the
  // Terminal reads identically to one inside the Code window.
  const terminalTheme = useMemo<ITheme>(() => {
    // Resolve the active accent: explicit override, else the engine's brand.
    const accent =
      accentColor && /^#[0-9a-fA-F]{6}$/.test(accentColor)
        ? accentColor
        : theme.accentColor;
    return {
      ...theme.terminal,
      cursor:              accent,
      selectionBackground: accent,
      selectionForeground: "#ffffff",
      selectionInactiveBackground: hexToRgba(accent, 0.45),
    };
  }, [theme, accentColor]);

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
