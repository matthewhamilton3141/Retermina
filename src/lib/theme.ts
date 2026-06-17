/**
 * Theme engine definitions.
 *
 * Retermina ships five "structural" theme engines. Each carries:
 *  - CSS-side tokens (index.css, keyed off data-theme)
 *  - An xterm.js color table (JS only — the canvas is painted, not CSS-styled)
 *  - An accentColor string so JS integrations (Claude Code panel, etc.) can
 *    read the active accent without touching the DOM or parsing CSS variables.
 */
import type { ITheme } from "@xterm/xterm";

export type ThemeId = "pastel" | "sleek" | "glass" | "minimalist" | "brutalism";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  description: string;
  /** Primary accent hex — synced to Claude Code and other JS integrations. */
  accentColor: string;
  terminal: ITheme;
}

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
    accentColor: "#38bdf8",
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

export const THEME_BY_ID: Record<ThemeId, ThemeMeta> = THEMES.reduce(
  (acc, theme) => {
    acc[theme.id] = theme;
    return acc;
  },
  {} as Record<ThemeId, ThemeMeta>,
);

export const DEFAULT_THEME_ID: ThemeId = "sleek";

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && value in THEME_BY_ID;
}

export function resolveTheme(id: unknown): ThemeMeta {
  return isThemeId(id) ? THEME_BY_ID[id] : THEME_BY_ID[DEFAULT_THEME_ID];
}