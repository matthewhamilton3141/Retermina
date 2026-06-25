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
  /**
   * The engine's primary accent as a plain hex string (matches `--rt-accent`
   * in index.css for this engine). CSS custom properties aren't readable as
   * plain values without a DOM round-trip, so anything in JS that needs the
   * accent color directly — the theme switcher's swatch dots, external
   * integrations like Claude Code's accent sync — reads it from here instead.
   */
  accentColor: string;
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
    accentColor: "#34d399",
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
      blue: "#34d399",
      magenta: "#c084fc",
      cyan: "#22d3ee",
      white: "#e5e5e5",
      brightBlack: "#525252",
      brightRed: "#fca5a5",
      brightGreen: "#6ee7b7",
      brightYellow: "#fcd34d",
      brightBlue: "#6ee7b7",
      brightMagenta: "#d8b4fe",
      brightCyan: "#67e8f9",
      brightWhite: "#fafafa",
    },
  },
  {
    id: "pastel",
    label: "Soft Pastel",
    description: "Light, airy surfaces with generous rounding.",
    accentColor: "#8b5cf6",
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
      blue: "#8b5cf6",
      magenta: "#a78bfa",
      cyan: "#5fb3c4",
      white: "#6b6480",
      brightBlack: "#8b80a3",
      brightRed: "#f08bb5",
      brightGreen: "#74c4a4",
      brightYellow: "#e6b878",
      brightBlue: "#a78bfa",
      brightMagenta: "#c4b0fd",
      brightCyan: "#7fc8d6",
      brightWhite: "#9a93ad",
    },
  },
  {
    id: "glass",
    label: "Transparent Glass",
    description: "Frosted, translucent panels in neutral white and grey.",
    accentColor: "#5b5f68",
    terminal: {
      background: "#f2f3f4",
      foreground: "#2a2c30",
      cursor: "#5b5f68",
      cursorAccent: "#f2f3f4",
      selectionBackground: "#5b5f6833",
      black: "#3a3c41",
      red: "#c4423a",
      green: "#3f8a5e",
      yellow: "#a4801f",
      blue: "#4a6fa5",
      magenta: "#8a5fa0",
      cyan: "#3f8a93",
      white: "#6b6e75",
      brightBlack: "#9a9ca3",
      brightRed: "#d9645c",
      brightGreen: "#5cab7d",
      brightYellow: "#c4a23f",
      brightBlue: "#6b8cb8",
      brightMagenta: "#a880bd",
      brightCyan: "#5fa9b1",
      brightWhite: "#16171a",
    },
  },
  {
    id: "minimalist",
    label: "Minimalist",
    description: "Flat, shadowless, near-monochrome on white.",
    accentColor: "#111111",
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
      blue: "#374151",
      magenta: "#7e22ce",
      cyan: "#0e7490",
      white: "#52525b",
      brightBlack: "#71717a",
      brightRed: "#dc2626",
      brightGreen: "#16a34a",
      brightYellow: "#ca8a04",
      brightBlue: "#4b5563",
      brightMagenta: "#9333ea",
      brightCyan: "#0891b2",
      brightWhite: "#18181b",
    },
  },
  {
    id: "brutalism",
    label: "Neo-Brutalism",
    description: "Thick black borders, hard shadows, sharp corners.",
    accentColor: "#16a34a",
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
      blue: "#16a34a",
      magenta: "#c026d3",
      cyan: "#0891b2",
      white: "#27272a",
      brightBlack: "#000000",
      brightRed: "#ef4444",
      brightGreen: "#22c55e",
      brightYellow: "#eab308",
      brightBlue: "#22c55e",
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

/**
 * `COLORFGBG` value ("fg;bg" colour indices) for a terminal background hex.
 * Light background → "0;15" (dark text on light); dark → "15;0" (light on
 * dark). Passed into the PTY so CLI tools that probe COLORFGBG (Claude Code,
 * vim, less) pick a legible foreground instead of assuming a dark terminal.
 */
export function terminalColorFgbg(background: string | undefined): string {
  const hex = (background ?? "").replace("#", "");
  if (hex.length < 6) return "15;0";
  const n = parseInt(hex.slice(0, 6), 16);
  if (Number.isNaN(n)) return "15;0";
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.5 ? "0;15" : "15;0";
}

/** Whether an engine reads as light (light surface, dark text). */
export function isLightTheme(theme: ThemeMeta): boolean {
  return terminalColorFgbg(theme.terminal.background) === "0;15";
}

/**
 * Claude Code UI theme that best matches an engine. We use the `*-ansi` variants
 * so Claude paints with the terminal's own 16-colour palette (this engine's
 * `terminal` table) instead of its stock colours — making the embedded Claude
 * Code panel inherit the active engine's personality. Light/dark tracks the
 * engine's surface so text stays legible.
 */
export function claudeThemeForEngine(theme: ThemeMeta): "light-ansi" | "dark-ansi" {
  return isLightTheme(theme) ? "light-ansi" : "dark-ansi";
}
