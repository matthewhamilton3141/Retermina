import { describe, it, expect } from "vitest";
import {
  terminalColorFgbg,
  isLightTheme,
  claudeThemeForEngine,
  isThemeId,
  resolveTheme,
  THEME_BY_ID,
  DEFAULT_THEME_ID,
} from "./theme";

describe("terminalColorFgbg", () => {
  it("maps a light background to dark-on-light indices", () => {
    expect(terminalColorFgbg("#faf7ff")).toBe("0;15");
    expect(terminalColorFgbg("#ffffff")).toBe("0;15");
  });

  it("maps a dark background to light-on-dark indices", () => {
    expect(terminalColorFgbg("#0a0a0a")).toBe("15;0");
    expect(terminalColorFgbg("#000000")).toBe("15;0");
  });

  it("falls back to dark for missing, short, or non-hex input", () => {
    expect(terminalColorFgbg(undefined)).toBe("15;0");
    expect(terminalColorFgbg("#fff")).toBe("15;0");
    expect(terminalColorFgbg("#zzzzzz")).toBe("15;0");
  });
});

describe("isLightTheme / claudeThemeForEngine", () => {
  it("classifies the bundled engines by surface brightness", () => {
    expect(isLightTheme(THEME_BY_ID.pastel)).toBe(true);
    expect(isLightTheme(THEME_BY_ID.minimalist)).toBe(true);
    expect(isLightTheme(THEME_BY_ID.brutalism)).toBe(true);
    expect(isLightTheme(THEME_BY_ID.sleek)).toBe(false);
  });

  it("picks the matching Claude ANSI variant for each engine", () => {
    expect(claudeThemeForEngine(THEME_BY_ID.pastel)).toBe("light-ansi");
    expect(claudeThemeForEngine(THEME_BY_ID.sleek)).toBe("dark-ansi");
  });
});

describe("isThemeId / resolveTheme", () => {
  it("accepts known ids and rejects everything else", () => {
    expect(isThemeId("sleek")).toBe(true);
    expect(isThemeId("pastel")).toBe(true);
    expect(isThemeId("nope")).toBe(false);
    expect(isThemeId(123)).toBe(false);
    expect(isThemeId(null)).toBe(false);
  });

  it("resolves a valid id and falls back to the default for junk", () => {
    expect(resolveTheme("pastel").id).toBe("pastel");
    expect(resolveTheme("does-not-exist").id).toBe(DEFAULT_THEME_ID);
    expect(resolveTheme(undefined).id).toBe(DEFAULT_THEME_ID);
  });
});
