/**
 * User-defined backdrop gradients.
 *
 * A small, serializable model the in-app editor manipulates and the
 * ThemeProvider renders to a CSS `background-image` value. Kept structured
 * (rather than a raw CSS string) so the editor can round-trip and re-edit it.
 */

export interface GradientStop {
  /** #rrggbb. */
  color: string;
  /** Position along the gradient, 0–100. */
  pos: number;
}

export interface CustomGradient {
  type: "linear" | "radial";
  /** Direction in degrees for linear gradients (ignored for radial). */
  angle: number;
  /** Two or more colour stops in display order. */
  stops: GradientStop[];
}

export const DEFAULT_CUSTOM_GRADIENT: CustomGradient = {
  type: "linear",
  angle: 135,
  stops: [
    { color: "#34d399", pos: 0 },
    { color: "#3b82f6", pos: 100 },
  ],
};

export const MAX_GRADIENT_STOPS = 6;

const HEX = /^#[0-9a-fA-F]{6}$/;
const clampPos = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const clampAngle = (n: number) => ((Math.round(n) % 360) + 360) % 360;

/** Render a {@link CustomGradient} to a CSS `background-image` value. */
export function gradientToCss(g: CustomGradient): string {
  const stops = g.stops.map((s) => `${s.color} ${clampPos(s.pos)}%`).join(", ");
  return g.type === "radial"
    ? `radial-gradient(circle at 50% 50%, ${stops})`
    : `linear-gradient(${clampAngle(g.angle)}deg, ${stops})`;
}

/** Coerce unknown persisted data into a valid gradient, or null if unusable. */
export function sanitizeGradient(value: unknown): CustomGradient | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<CustomGradient>;
  const type = v.type === "radial" ? "radial" : "linear";
  const angle = typeof v.angle === "number" ? clampAngle(v.angle) : 135;
  const stops = Array.isArray(v.stops)
    ? v.stops
        .filter((s): s is GradientStop =>
          !!s && typeof s.color === "string" && HEX.test(s.color) && typeof s.pos === "number")
        .map((s) => ({ color: s.color, pos: clampPos(s.pos) }))
    : [];
  if (stops.length < 2) return null;
  return { type, angle, stops: stops.slice(0, MAX_GRADIENT_STOPS) };
}
