/** Named font options for decoupled typography. */
export interface FontOption {
  id: string;
  name: string;
  description: string;
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
    name: "Minimalist",
    description: "Inter — clean, precise, and highly legible",
    stack: '"Inter", system-ui, sans-serif',
  },
  {
    id: "space-grotesk",
    name: "Neo-brutalism",
    description: "Space Grotesk — bold, geometric, and assertive",
    stack: '"Space Grotesk", system-ui, sans-serif',
  },
  {
    id: "nunito",
    name: "Soft Pastel",
    description: "Nunito — rounded, friendly, and warm",
    stack: '"Nunito", ui-rounded, system-ui, sans-serif',
  },
  {
    id: "jetbrains-mono",
    name: "Terminal",
    description: "JetBrains Mono — high-readability monospace",
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
