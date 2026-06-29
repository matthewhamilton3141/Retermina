import { describe, expect, it } from "vitest";

import {
  DEFAULT_CUSTOM_GRADIENT,
  gradientToCss,
  sanitizeGradient,
  type CustomGradient,
} from "./gradient";

describe("gradientToCss", () => {
  it("renders a linear gradient with angle and stops", () => {
    expect(gradientToCss(DEFAULT_CUSTOM_GRADIENT)).toBe(
      "linear-gradient(135deg, #34d399 0%, #3b82f6 100%)",
    );
  });

  it("renders a radial gradient centred", () => {
    const g: CustomGradient = {
      type: "radial",
      angle: 0,
      stops: [{ color: "#000000", pos: 0 }, { color: "#ffffff", pos: 80 }],
    };
    expect(gradientToCss(g)).toBe(
      "radial-gradient(circle at 50% 50%, #000000 0%, #ffffff 80%)",
    );
  });

  it("clamps positions and normalizes the angle", () => {
    const g: CustomGradient = {
      type: "linear",
      angle: 405,
      stops: [{ color: "#111111", pos: -20 }, { color: "#222222", pos: 140 }],
    };
    expect(gradientToCss(g)).toBe("linear-gradient(45deg, #111111 0%, #222222 100%)");
  });
});

describe("sanitizeGradient", () => {
  it("accepts a valid gradient and clamps its values", () => {
    expect(
      sanitizeGradient({ type: "linear", angle: 720, stops: [{ color: "#aabbcc", pos: 200 }, { color: "#001122", pos: 0 }] }),
    ).toEqual({ type: "linear", angle: 0, stops: [{ color: "#aabbcc", pos: 100 }, { color: "#001122", pos: 0 }] });
  });

  it("rejects gradients with fewer than two valid stops", () => {
    expect(sanitizeGradient({ type: "linear", angle: 0, stops: [{ color: "#fff", pos: 0 }] })).toBeNull();
    expect(sanitizeGradient({ stops: [{ color: "nothex", pos: 0 }, { color: "#000000", pos: 1 }] })).toBeNull();
    expect(sanitizeGradient(null)).toBeNull();
    expect(sanitizeGradient("nope")).toBeNull();
  });

  it("drops invalid stops and defaults the type to linear", () => {
    const out = sanitizeGradient({
      type: "weird",
      stops: [
        { color: "#123456", pos: 10 },
        { color: "bad", pos: 50 },
        { color: "#abcdef", pos: 90 },
      ],
    });
    expect(out).toEqual({
      type: "linear",
      angle: 135,
      stops: [{ color: "#123456", pos: 10 }, { color: "#abcdef", pos: 90 }],
    });
  });
});
