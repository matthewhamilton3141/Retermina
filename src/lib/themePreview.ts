/**
 * Static, self-contained palettes for rendering *mini theme previews* — the
 * little mockups in the theme switcher and the Loom thumbnails.
 *
 * These are deliberately independent of the live `--rt-*` cascade so a preview
 * always paints in its OWN engine's colors regardless of the active theme (a
 * dark engine's card stays dark even while the app is light). The marketplace
 * reuses the same data to draw a Loom thumbnail entirely from its JSON — no
 * stored screenshots.
 */
import { gradientToCss, type CustomGradient } from "./gradient";
import type { BackdropStyle } from "../store/app";

export interface PreviewPalette {
  bg: string;
  surface: string;
  text: string;
}

/** Per-engine base palette (background / surface / text). */
export const THEME_PREVIEW_PALETTES: Record<string, PreviewPalette> = {
  sleek:      { bg: "#0a0a0a", surface: "#171717", text: "#f5f5f5" },
  pastel:     { bg: "#f6f4fb", surface: "#ffffff", text: "#4c4361" },
  glass:      { bg: "#dde0e8", surface: "#f5f6f8", text: "#1c1e21" },
  minimalist: { bg: "#ffffff", surface: "#fafafa", text: "#18181b" },
  brutalism:  { bg: "#fafaf5", surface: "#ffffff", text: "#0a0a0a" },
};

/** Each engine's default accent — used when a Loom carries no accent override. */
export const ENGINE_ACCENT: Record<string, string> = {
  sleek: "#34d399",
  pastel: "#8b5cf6",
  glass: "#4a6fa5",
  minimalist: "#111111",
  brutalism: "#16a34a",
};

const FALLBACK_PALETTE: PreviewPalette = { bg: "#ffffff", surface: "#f0f0f0", text: "#000000" };

export function previewPalette(themeId: string): PreviewPalette {
  return THEME_PREVIEW_PALETTES[themeId] ?? FALLBACK_PALETTE;
}

export function previewAccent(themeId: string, accentColor: string | null): string {
  return accentColor ?? ENGINE_ACCENT[themeId] ?? "#34d399";
}

/** #rrggbb → rgba() at the given alpha (defensive: bad input → transparent black). */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return `rgba(0,0,0,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * The CSS `background-image` for a Loom's backdrop, computed from the accent
 * hex so it's self-contained (the live app derives these via color-mix, but a
 * preview can't read the cascade). Returns undefined for a solid backdrop.
 */
export function previewBackdropCss(
  backdropStyle: BackdropStyle,
  customBackdrop: CustomGradient,
  accent: string,
): string | undefined {
  switch (backdropStyle) {
    case "custom":
      return gradientToCss(customBackdrop);
    case "gradient":
      return (
        `radial-gradient(120% 120% at 0% 0%, ${hexToRgba(accent, 0.22)}, transparent 55%), ` +
        `radial-gradient(120% 120% at 100% 100%, ${hexToRgba(accent, 0.14)}, transparent 55%)`
      );
    case "mesh":
      return (
        `radial-gradient(45% 45% at 15% 20%, ${hexToRgba(accent, 0.26)}, transparent 70%), ` +
        `radial-gradient(48% 48% at 85% 15%, ${hexToRgba(accent, 0.16)}, transparent 70%), ` +
        `radial-gradient(52% 52% at 78% 88%, ${hexToRgba(accent, 0.22)}, transparent 72%), ` +
        `radial-gradient(42% 42% at 18% 92%, ${hexToRgba(accent, 0.14)}, transparent 70%)`
      );
    default:
      return undefined; // solid
  }
}
