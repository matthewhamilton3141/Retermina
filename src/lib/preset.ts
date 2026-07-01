/**
 * Retermina Loom — the unified preset schema.
 *
 * A "Loom" bundles a complete app configuration into one portable JSON
 * document: the cosmetic state (theme engine, accent, typography, chrome
 * preferences, text scale) and the structural state (the react-grid-layout
 * topology plus the panels it hosts). Looms are stored in `presets.json` under
 * the app data directory and can be exported/imported as standalone `.json`
 * files to share whole workspaces between machines.
 *
 * Everything here is plain JSON and defensively validated: a hand-edited or
 * corrupted document never crashes the workspace — `sanitizePreset` repairs
 * what it can and falls back to the default layout for the rest.
 */
import {
  DEFAULT_THEME_ID,
  isThemeId,
  type ThemeId,
} from "./theme";
import {
  createDefaultWorkspaceLayout,
  isWorkspaceGridArray,
  isWorkspacePanelArray,
  reconcileWorkspaceLayout,
  sanitizeGridItem,
  type WorkspaceGridItem,
  type WorkspacePanel,
} from "./workspaceLayout";
import { TERMINAL_FONT_SIZE } from "./fonts";
import { DEFAULT_CUSTOM_GRADIENT, sanitizeGradient, type CustomGradient } from "./gradient";
import type { ToolbarStyle, TopBarStyle, MotionPreference, BackdropStyle } from "../store/app";

/** Bump when the on-disk preset shape changes incompatibly. */
export const PRESET_VERSION = 1;

/** Tag identifying a document as a Retermina Loom (sanity check on import). */
export const PRESET_SCHEMA = "retermina-loom";

/**
 * What a Loom applies. "full" re-skins the theme *and* swaps the layout;
 * "layout" swaps only the panel arrangement, leaving the theme untouched
 * (the successor to the old toolbar-only workspace presets).
 */
export type PresetScope = "full" | "layout";

/** Cosmetic half of a preset. */
export interface PresetTheme {
  themeId: ThemeId;
  accentColor: string | null;
  topBarStyle: TopBarStyle;
  toolbarStyle: ToolbarStyle;
  fontId: string;
  uiScale: number;
  /** Terminal typeface + size. */
  terminalFontId: string;
  terminalFontSize: number;
  /** Accessibility preferences. */
  motionPreference: MotionPreference;
  highContrast: boolean;
  reduceTransparency: boolean;
  terminalCursorBlink: boolean;
  /** Workspace backdrop (incl. a user-defined gradient). */
  backdropStyle: BackdropStyle;
  customBackdrop: CustomGradient;
}

/** Structural half of a preset. */
export interface PresetWorkspace {
  panels: WorkspacePanel[];
  grid: WorkspaceGridItem[];
  /** Per-panel text-zoom overrides, keyed by panel id. */
  panelFontSizes: Record<string, number>;
}

/**
 * A custom font carried inside an exported Loom so the typeface travels with
 * the preset. `data` is the base64-encoded font file.
 */
export interface PresetFontAsset {
  id: string;
  name: string;
  family: string;
  fileName: string;
  category: string;
  data: string;
}

/** The complete, serializable Loom document. */
export interface ReterminaPreset {
  schema: typeof PRESET_SCHEMA;
  version: number;
  id: string;
  name: string;
  createdAt: number;
  /** What applying this Loom touches. Absent in v1 documents → "full". */
  scope: PresetScope;
  theme: PresetTheme;
  workspace: PresetWorkspace;
  /** Optional bundled assets (e.g. custom fonts the theme references). */
  assets?: { fonts: PresetFontAsset[] };
}

const VALID_TOOLBAR: ToolbarStyle[]      = ["dropdown", "icons"];
const VALID_TOPBAR: TopBarStyle[]        = ["icon-only", "icon-and-text"];
const VALID_MOTION: MotionPreference[]   = ["system", "full", "reduced"];
const VALID_BACKDROP: BackdropStyle[]    = ["solid", "gradient", "mesh", "custom"];

/** Clamp the UI scale into the supported range, defaulting to 100. */
function safeScale(value: unknown): number {
  return typeof value === "number" && value >= 80 && value <= 130 ? Math.round(value) : 100;
}

/** Clamp the terminal font size into its supported range, defaulting sanely. */
function safeTerminalFontSize(value: unknown): number {
  return typeof value === "number"
    ? Math.max(TERMINAL_FONT_SIZE.min, Math.min(TERMINAL_FONT_SIZE.max, Math.round(value)))
    : TERMINAL_FONT_SIZE.default;
}

/**
 * Coerce an arbitrary parsed object into a valid {@link PresetTheme}, falling
 * back to sane defaults for any missing or malformed field.
 */
function sanitizeTheme(raw: unknown): PresetTheme {
  const t = (raw ?? {}) as Record<string, unknown>;
  return {
    themeId: isThemeId(t.themeId) ? t.themeId : DEFAULT_THEME_ID,
    accentColor:
      typeof t.accentColor === "string" && /^#[0-9a-fA-F]{6}$/.test(t.accentColor)
        ? t.accentColor
        : null,
    topBarStyle: VALID_TOPBAR.includes(t.topBarStyle as TopBarStyle)
      ? (t.topBarStyle as TopBarStyle)
      : "icon-only",
    toolbarStyle: VALID_TOOLBAR.includes(t.toolbarStyle as ToolbarStyle)
      ? (t.toolbarStyle as ToolbarStyle)
      : "dropdown",
    fontId: typeof t.fontId === "string" ? t.fontId : "default",
    uiScale: safeScale(t.uiScale),
    terminalFontId: typeof t.terminalFontId === "string" ? t.terminalFontId : "default",
    terminalFontSize: safeTerminalFontSize(t.terminalFontSize),
    motionPreference: VALID_MOTION.includes(t.motionPreference as MotionPreference)
      ? (t.motionPreference as MotionPreference)
      : "system",
    highContrast: typeof t.highContrast === "boolean" ? t.highContrast : false,
    reduceTransparency: typeof t.reduceTransparency === "boolean" ? t.reduceTransparency : false,
    terminalCursorBlink: typeof t.terminalCursorBlink === "boolean" ? t.terminalCursorBlink : true,
    backdropStyle: VALID_BACKDROP.includes(t.backdropStyle as BackdropStyle)
      ? (t.backdropStyle as BackdropStyle)
      : "solid",
    customBackdrop: sanitizeGradient(t.customBackdrop) ?? DEFAULT_CUSTOM_GRADIENT,
  };
}

/**
 * Coerce an arbitrary parsed object into a renderable {@link PresetWorkspace}.
 * Corrupt or missing layout data falls back to the default workspace grid so
 * the window never mounts an empty or broken layout.
 */
function sanitizeWorkspace(raw: unknown): PresetWorkspace {
  const w = (raw ?? {}) as Record<string, unknown>;

  if (isWorkspacePanelArray(w.panels) && w.panels.length > 0 && isWorkspaceGridArray(w.grid)) {
    const { panels, grid } = reconcileWorkspaceLayout(w.panels, w.grid);
    const fontSizes: Record<string, number> = {};
    if (w.panelFontSizes && typeof w.panelFontSizes === "object") {
      for (const [k, v] of Object.entries(w.panelFontSizes as Record<string, unknown>)) {
        if (typeof v === "number") fontSizes[k] = Math.max(70, Math.min(150, v));
      }
    }
    return { panels, grid, panelFontSizes: fontSizes };
  }

  // Graceful fallback — default three-column layout.
  const fresh = createDefaultWorkspaceLayout();
  return { panels: fresh.panels, grid: fresh.grid.map(sanitizeGridItem), panelFontSizes: {} };
}

/**
 * Parse and fully sanitize an untrusted preset document (from disk or an
 * imported file). Returns null only when the input isn't an object at all;
 * otherwise it always yields a renderable preset (repairing fields as needed).
 */
export function parsePreset(raw: unknown): ReterminaPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;

  const assets =
    p.assets && typeof p.assets === "object" && Array.isArray((p.assets as { fonts?: unknown }).fonts)
      ? { fonts: ((p.assets as { fonts: unknown[] }).fonts).filter(isFontAsset) }
      : undefined;

  return {
    schema: PRESET_SCHEMA,
    version: typeof p.version === "number" ? p.version : PRESET_VERSION,
    id: typeof p.id === "string" ? p.id : crypto.randomUUID(),
    name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : "Imported Loom",
    createdAt: typeof p.createdAt === "number" ? p.createdAt : Date.now(),
    scope: p.scope === "layout" ? "layout" : "full",
    theme: sanitizeTheme(p.theme),
    workspace: sanitizeWorkspace(p.workspace),
    ...(assets && assets.fonts.length ? { assets } : {}),
  };
}

function isFontAsset(v: unknown): v is PresetFontAsset {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  return (
    typeof f.family === "string" &&
    typeof f.fileName === "string" &&
    typeof f.data === "string"
  );
}

/** Build a fresh preset payload from captured theme + workspace state. */
export function buildPreset(
  name: string,
  theme: PresetTheme,
  workspace: PresetWorkspace,
  assets?: { fonts: PresetFontAsset[] },
  scope: PresetScope = "full",
): ReterminaPreset {
  return {
    schema: PRESET_SCHEMA,
    version: PRESET_VERSION,
    id: crypto.randomUUID(),
    name: name.trim() || "Untitled Loom",
    createdAt: Date.now(),
    scope,
    theme,
    workspace: {
      panels: workspace.panels,
      grid: workspace.grid.map(sanitizeGridItem),
      panelFontSizes: workspace.panelFontSizes,
    },
    ...(assets && assets.fonts.length ? { assets } : {}),
  };
}
