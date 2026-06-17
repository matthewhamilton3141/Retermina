/**
 * Theme engine definitions.
 *
 * Retermina ships five "structural" theme engines — they swap far more than
 * accent colors: corner radius, border weight, shadows (hard offset shadows for
 * Neo-Brutalism), backdrop blur (Transparent Glass), light vs. dark surfaces,
 * fonts, and icon stroke weight all change per engine.
 *
 * The bulk of that styling is expressed as CSS custom properties keyed off a
 * `data-theme` attribute on `<html>` (see `src/index.css`). A single attribute
 * swap re-skins the entire DOM with no React re-render — which matters because
 * the live terminal panel is memoized and must not remount on a theme change.
 *
 * This module owns the pieces that CANNOT live in CSS: the metadata used to
 * build the theme switcher, and the xterm.js color table for each engine (the
 * terminal canvas is painted from a JS object, not styled by CSS). Everything
 * here is plain data so a theme can later be exported as part of a preset.
 */
import type { ITheme } from "@xterm/xterm";

/** Stable identifier for each built-in engine. */
export type ThemeId = "pastel" | "sleek" | "glass" | "minimalist" | "brutalism";

/** Human-facing metadata plus the engine's xterm color table. */
export interface ThemeMeta {
  id: ThemeId;
  label: string;
  description: string;
  /** xterm.js canvas colors. Painted on a canvas, so it must be JS, not CSS. */
  terminal: ITheme;
}

/**
 * Every engine, in the order the switcher lists them. The xterm palettes are
 * tuned to match each engine's CSS surface so the terminal canvas blends into
 * its panel (note the light terminals for Pastel / Minimalist / Brutalism).
 */
export const THEMES: readonly ThemeMeta[] = [
  {
    id: "sleek",
    label: "Sleek",
    description: "Modern dark surfaces with an emerald accent.",
    terminal: {
      background: "#0a0a0a",
      foreground: "#e5e5e5",
      cursor: "#34d399",
      cursorAccent: "#0a0a0a",
      selectionBackground: "#34d39933",
      black: "#171717",
      red: "#f87171",
      green: "#34d399",
      yellow: "#fbbf24",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#22d3ee",
      white: "#e5e5e5",
      brightBlack: "#525252",
      brightRed: "#fca5a5",
      brightGreen: "#6ee7b7",
      brightYellow: "#fcd34d",
      brightBlue: "#93c5fd",
      brightMagenta: "#d8b4fe",
      brightCyan: "#67e8f9",
      brightWhite: "#fafafa",
    },
  },
  {
    id: "pastel",
    label: "Soft Pastel",
    description: "Light, airy surfaces with generous rounding.",
    terminal: {
      background: "#faf7ff",
      foreground: "#4c4361",
      cursor: "#8b5cf6",
      cursorAccent: "#faf7ff",
      selectionBackground: "#8b5cf633",
      black: "#4c4361",
      red: "#e06c9f",
      green: "#5fa98c",
      yellow: "#d6a35c",
      blue: "#7aa2e3",
      magenta: "#a78bfa",
      cyan: "#5fb3c4",
      white: "#6b6480",
      brightBlack: "#8b80a3",
      brightRed: "#f08bb5",
      brightGreen: "#74c4a4",
      brightYellow: "#e6b878",
      brightBlue: "#95b8ef",
      brightMagenta: "#c4b0fd",
      brightCyan: "#7fc8d6",
      brightWhite: "#9a93ad",
    },
  },
  {
    id: "glass",
    label: "Transparent Glass",
    description: "Frosted, translucent panels over a deep gradient.",
    terminal: {
      background: "#0b1220",
      foreground: "#e2e8f0",
      cursor: "#38bdf8",
      cursorAccent: "#0b1220",
      selectionBackground: "#38bdf833",
      black: "#1e293b",
      red: "#fb7185",
      green: "#34d399",
      yellow: "#fcd34d",
      blue: "#38bdf8",
      magenta: "#c084fc",
      cyan: "#22d3ee",
      white: "#e2e8f0",
      brightBlack: "#475569",
      brightRed: "#fda4af",
      brightGreen: "#6ee7b7",
      brightYellow: "#fde68a",
      brightBlue: "#7dd3fc",
      brightMagenta: "#d8b4fe",
      brightCyan: "#67e8f9",
      brightWhite: "#f1f5f9",
    },
  },
  {
    id: "minimalist",
    label: "Minimalist",
    description: "Flat, shadowless, near-monochrome on white.",
    terminal: {
      background: "#fafafa",
      foreground: "#27272a",
      cursor: "#18181b",
      cursorAccent: "#fafafa",
      selectionBackground: "#18181b22",
      black: "#27272a",
      red: "#b91c1c",
      green: "#15803d",
      yellow: "#a16207",
      blue: "#1d4ed8",
      magenta: "#7e22ce",
      cyan: "#0e7490",
      white: "#52525b",
      brightBlack: "#71717a",
      brightRed: "#dc2626",
      brightGreen: "#16a34a",
      brightYellow: "#ca8a04",
      brightBlue: "#2563eb",
      brightMagenta: "#9333ea",
      brightCyan: "#0891b2",
      brightWhite: "#18181b",
    },
  },
  {
    id: "brutalism",
    label: "Neo-Brutalism",
    description: "Thick black borders, hard shadows, sharp corners.",
    terminal: {
      background: "#ffffff",
      foreground: "#0a0a0a",
      cursor: "#16a34a",
      cursorAccent: "#ffffff",
      selectionBackground: "#16a34a33",
      black: "#0a0a0a",
      red: "#dc2626",
      green: "#16a34a",
      yellow: "#ca8a04",
      blue: "#2563eb",
      magenta: "#c026d3",
      cyan: "#0891b2",
      white: "#27272a",
      brightBlack: "#000000",
      brightRed: "#ef4444",
      brightGreen: "#22c55e",
      brightYellow: "#eab308",
      brightBlue: "#3b82f6",
      brightMagenta: "#d946ef",
      brightCyan: "#06b6d4",
      brightWhite: "#000000",
    },
  },
];

/** Engine lookup by id. */
export const THEME_BY_ID: Record<ThemeId, ThemeMeta> = THEMES.reduce(
  (acc, theme) => {
    acc[theme.id] = theme;
    return acc;
  },
  {} as Record<ThemeId, ThemeMeta>,
);

/** The engine applied on first run and used as the fallback for bad state. */
export const DEFAULT_THEME_ID: ThemeId = "sleek";

/** Runtime guard for a persisted/untrusted theme id. */
export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && value in THEME_BY_ID;
}

/** Resolve any id to a known engine, falling back to the default. */
export function resolveTheme(id: unknown): ThemeMeta {
  return isThemeId(id) ? THEME_BY_ID[id] : THEME_BY_ID[DEFAULT_THEME_ID];
}
