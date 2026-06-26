import { describe, it, expect } from "vitest";
import {
  parsePreset,
  buildPreset,
  PRESET_SCHEMA,
  PRESET_VERSION,
  type PresetTheme,
  type PresetWorkspace,
} from "./preset";
import { DEFAULT_THEME_ID } from "./theme";

describe("parsePreset — rejects non-objects", () => {
  it("returns null for primitives and nullish input", () => {
    expect(parsePreset(null)).toBeNull();
    expect(parsePreset(undefined)).toBeNull();
    expect(parsePreset("a string")).toBeNull();
    expect(parsePreset(42)).toBeNull();
  });
});

describe("parsePreset — repairs partial documents", () => {
  it("fills sane defaults for an empty object", () => {
    const p = parsePreset({})!;
    expect(p).not.toBeNull();
    expect(p.schema).toBe(PRESET_SCHEMA);
    expect(p.name).toBe("Imported Loom");
    expect(p.theme.themeId).toBe(DEFAULT_THEME_ID);
    expect(p.theme.accentColor).toBeNull();
    expect(p.theme.uiScale).toBe(100);
    // Falls back to a renderable default workspace, never empty.
    expect(p.workspace.panels.length).toBeGreaterThan(0);
    expect(p.workspace.grid.length).toBeGreaterThan(0);
    expect(typeof p.id).toBe("string");
  });

  it("keeps a valid accent hex and drops a malformed one", () => {
    expect(parsePreset({ theme: { accentColor: "#8b5cf6" } })!.theme.accentColor).toBe("#8b5cf6");
    expect(parsePreset({ theme: { accentColor: "#fff" } })!.theme.accentColor).toBeNull();
    expect(parsePreset({ theme: { accentColor: "red" } })!.theme.accentColor).toBeNull();
  });

  it("clamps uiScale into the 80–130 range and rounds it", () => {
    expect(parsePreset({ theme: { uiScale: 200 } })!.theme.uiScale).toBe(100);
    expect(parsePreset({ theme: { uiScale: 50 } })!.theme.uiScale).toBe(100);
    expect(parsePreset({ theme: { uiScale: 105.6 } })!.theme.uiScale).toBe(106);
    expect(parsePreset({ theme: { uiScale: 80 } })!.theme.uiScale).toBe(80);
  });

  it("defaults invalid chrome styles", () => {
    const p = parsePreset({ theme: { topBarStyle: "bogus", toolbarStyle: "bogus" } })!;
    expect(p.theme.topBarStyle).toBe("icon-only");
    expect(p.theme.toolbarStyle).toBe("dropdown");
  });

  it("trims a provided name and preserves it", () => {
    expect(parsePreset({ name: "  My Loom  " })!.name).toBe("My Loom");
  });
});

describe("parsePreset — bundled font assets", () => {
  it("keeps well-formed font assets and discards malformed ones", () => {
    const p = parsePreset({
      assets: {
        fonts: [
          { id: "1", name: "Good", family: "Good", fileName: "good.ttf", category: "ui", data: "AAAA" },
          { family: 123, fileName: "bad.ttf", data: "AAAA" }, // bad family type
          "not an object",
        ],
      },
    })!;
    expect(p.assets?.fonts).toHaveLength(1);
    expect(p.assets?.fonts[0].family).toBe("Good");
  });

  it("omits the assets key entirely when no valid fonts remain", () => {
    const p = parsePreset({ assets: { fonts: [{ nope: true }] } })!;
    expect(p.assets).toBeUndefined();
  });
});

describe("buildPreset", () => {
  const theme: PresetTheme = {
    themeId: "pastel",
    accentColor: "#8b5cf6",
    topBarStyle: "icon-only",
    toolbarStyle: "dropdown",
    fontId: "default",
    uiScale: 100,
  };
  const workspace: PresetWorkspace = { panels: [], grid: [], panelFontSizes: {} };

  it("stamps the current schema/version and a fresh id", () => {
    const p = buildPreset("Layout A", theme, workspace);
    expect(p.schema).toBe(PRESET_SCHEMA);
    expect(p.version).toBe(PRESET_VERSION);
    expect(p.name).toBe("Layout A");
    expect(p.id).toMatch(/[0-9a-f-]{36}/);
    expect(p.theme.themeId).toBe("pastel");
  });

  it("falls back to a placeholder name for an empty/whitespace name", () => {
    expect(buildPreset("   ", theme, workspace).name).toBe("Untitled Loom");
  });

  it("round-trips through parsePreset without losing the theme", () => {
    const built = buildPreset("RT", theme, workspace);
    const reparsed = parsePreset(JSON.parse(JSON.stringify(built)))!;
    expect(reparsed.theme.themeId).toBe("pastel");
    expect(reparsed.theme.accentColor).toBe("#8b5cf6");
    expect(reparsed.name).toBe("RT");
  });
});
