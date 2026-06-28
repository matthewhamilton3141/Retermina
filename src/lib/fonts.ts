import type { ThemeId } from "./theme";

/** Named font options for decoupled typography. */
export interface FontOption {
  id: string;
  name: string;
  description: string;
  /** Thematic category (matches {@link FONT_CATEGORIES}); omitted for Default. */
  category?: string;
  /** CSS font-family stack, or null for system default (no override). */
  stack: string | null;
}

export const FONTS: readonly FontOption[] = [
  {
    id: "default",
    name: "Default",
    description: "System UI — your OS's native interface font",
    stack: null,
  },
  {
    id: "inter",
    name: "Inter",
    description: "Clean, precise, and highly legible",
    category: "Minimalist",
    stack: '"Inter", system-ui, sans-serif',
  },
  {
    id: "space-grotesk",
    name: "Space Grotesk",
    description: "Bold, geometric, and assertive",
    category: "Neo-brutalism",
    stack: '"Space Grotesk", system-ui, sans-serif',
  },
  {
    id: "nunito",
    name: "Nunito",
    description: "Rounded, friendly, and warm",
    category: "Soft Pastel",
    stack: '"Nunito", ui-rounded, system-ui, sans-serif',
  },
  {
    id: "jetbrains-mono",
    name: "JetBrains Mono",
    description: "High-readability monospace",
    category: "Terminal",
    stack: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
  },
];

export const FONT_BY_ID: Record<string, FontOption> = Object.fromEntries(
  FONTS.map((f) => [f.id, f]),
);

/**
 * Thematic categories an uploaded font can be assigned to. These mirror the
 * built-in font "personalities" so a custom upload slots into the same mental
 * model as the bundled choices.
 */
export const FONT_CATEGORIES: readonly string[] = [
  "Minimalist",
  "Neo-brutalism",
  "Soft Pastel",
  "Terminal",
  "Display",
  "Uncategorized",
];

/** Build a CSS font-family stack for an uploaded font's registered family. */
export function customFontStack(family: string): string {
  return `"${family}", system-ui, sans-serif`;
}

// ── Terminal typeface ────────────────────────────────────────────────────────

/**
 * The xterm canvas paints from a JS font setting, not CSS, so it can't inherit
 * the UI `--rt-font-sans` token — it gets its own monospace-only preference.
 * This default mirrors what the viewport historically hard-coded.
 */
export const DEFAULT_TERMINAL_FONT_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace';

/** Sensible bounds + starting size for the terminal font-size control. */
export const TERMINAL_FONT_SIZE = { min: 9, max: 24, default: 13 } as const;

export interface TerminalFontOption {
  id: string;
  name: string;
  stack: string;
}

/**
 * Monospace choices offered for the terminal. "System Mono" is the no-override
 * default; the rest must be families bundled/loaded by the app (see index.html).
 * Uploaded fonts categorized "Terminal" are appended at the UI layer.
 */
export const TERMINAL_FONTS: readonly TerminalFontOption[] = [
  { id: "default", name: "System Mono", stack: DEFAULT_TERMINAL_FONT_STACK },
  {
    id: "jetbrains-mono",
    name: "JetBrains Mono",
    stack: '"JetBrains Mono", ui-monospace, monospace',
  },
];

/** Minimal shape needed to resolve an uploaded terminal font to a CSS stack. */
interface ResolvableFont {
  id: string;
  family: string;
}

/**
 * Resolve a terminal font id to a concrete CSS family stack: a built-in mono
 * option, an uploaded custom family, or the system default as a final fallback
 * (so a stale persisted id never leaves the terminal unstyled).
 */
export function resolveTerminalFontStack(
  id: string,
  customFonts: readonly ResolvableFont[],
): string {
  const builtIn = TERMINAL_FONTS.find((f) => f.id === id);
  if (builtIn) return builtIn.stack;
  const custom = customFonts.find((f) => f.id === id);
  if (custom) return customFontStack(custom.family);
  return DEFAULT_TERMINAL_FONT_STACK;
}

/**
 * Which font category "belongs to" each theme engine. Three engines share a
 * name with a font personality; Sleek and Transparent Glass have no canonical
 * pairing, so they map to `undefined` (no suggestion / no auto-pair).
 */
export const THEME_FONT_CATEGORY: Record<ThemeId, string | undefined> = {
  minimalist: "Minimalist",
  brutalism:  "Neo-brutalism",
  pastel:     "Soft Pastel",
  sleek:      undefined,
  glass:      undefined,
};

/** Minimal shape needed to resolve a categorized font (built-in or uploaded). */
interface CategorizedFont {
  id: string;
  category?: string;
}

/**
 * Resolve the best font id for a category: a user-uploaded font wins over a
 * built-in (uploads are prepended newest-first), otherwise the bundled match.
 * Returns null when nothing in the category exists.
 */
export function fontIdForCategory(
  category: string,
  customFonts: readonly CategorizedFont[],
): string | null {
  const custom = customFonts.find((f) => f.category === category);
  if (custom) return custom.id;
  const builtIn = FONTS.find((f) => f.category === category);
  return builtIn ? builtIn.id : null;
}
