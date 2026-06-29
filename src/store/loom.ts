/**
 * Retermina Loom store — the unified preset library.
 *
 * Holds the user's saved Looms (theme + workspace bundles) and the operations
 * to create, apply, delete, export, and import them. State is persisted to
 * `presets.json` in the app data directory through the Rust `read_presets` /
 * `write_presets` commands (a Tauri-file-backed Zustand storage), so presets
 * survive restarts independently of localStorage.
 *
 * Applying a preset writes straight into the app + workspace stores, which
 * re-skin the theme and re-mount the grid in real time. Every load runs through
 * `parsePreset`, so a corrupted layout degrades to the default grid instead of
 * crashing the window.
 */
import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";

import {
  PRESET_VERSION,
  buildPreset,
  parsePreset,
  type PresetFontAsset,
  type PresetTheme,
  type PresetWorkspace,
  type ReterminaPreset,
} from "../lib/preset";
import { readFile, writeFile, readPresets, writePresets } from "../lib/fs";
import { registerCustomFont } from "../lib/fontRegistry";
import { useAppStore } from "./app";
import { useWorkspaceStore } from "./workspace";

// ── Capture / apply bridges to the other stores ──────────────────────────────

function captureTheme(): PresetTheme {
  const a = useAppStore.getState();
  return {
    themeId: a.themeId,
    accentColor: a.accentColor,
    topBarStyle: a.topBarStyle,
    toolbarStyle: a.toolbarStyle,
    fontId: a.fontId,
    uiScale: a.uiScale,
    terminalFontId: a.terminalFontId,
    terminalFontSize: a.terminalFontSize,
    motionPreference: a.motionPreference,
    highContrast: a.highContrast,
    reduceTransparency: a.reduceTransparency,
    terminalCursorBlink: a.terminalCursorBlink,
    backdropStyle: a.backdropStyle,
    customBackdrop: a.customBackdrop,
  };
}

function captureWorkspace(): PresetWorkspace {
  const w = useWorkspaceStore.getState();
  // Privacy: a Loom captures ONLY layout geometry + panel identity. Never any
  // live-session state — no PTY/terminal buffers, no cwd, no open file paths or
  // contents. Panel titles are static kind labels (e.g. "Terminal"), not paths.
  // Presets stay local (presets.json / user-chosen file); nothing is uploaded.
  return { panels: w.panels, grid: w.grid, panelFontSizes: w.panelFontSizes };
}

/**
 * Re-hydrate the whole app from a preset. Theme fields land atomically via
 * setState (no auto-pair side effects), and the workspace store swaps panels +
 * grid so react-grid-layout re-mounts the new structure. Runs through
 * parsePreset first so any corruption is repaired / falls back to defaults.
 */
function applyPreset(preset: ReterminaPreset): void {
  const safe = parsePreset(preset) ?? preset;

  useAppStore.setState({
    themeId: safe.theme.themeId,
    accentColor: safe.theme.accentColor,
    topBarStyle: safe.theme.topBarStyle,
    toolbarStyle: safe.theme.toolbarStyle,
    fontId: safe.theme.fontId,
    uiScale: safe.theme.uiScale,
    terminalFontId: safe.theme.terminalFontId,
    terminalFontSize: safe.theme.terminalFontSize,
    motionPreference: safe.theme.motionPreference,
    highContrast: safe.theme.highContrast,
    reduceTransparency: safe.theme.reduceTransparency,
    terminalCursorBlink: safe.theme.terminalCursorBlink,
    backdropStyle: safe.theme.backdropStyle,
    customBackdrop: safe.theme.customBackdrop,
  });

  useWorkspaceStore.setState({
    panels: safe.workspace.panels,
    grid: safe.workspace.grid,
    panelFontSizes: safe.workspace.panelFontSizes,
  });
}

/**
 * Bundle the bytes of any locally-uploaded fonts the preset references — both
 * the UI font (`fontId`) and the terminal font (`terminalFontId`) — so the
 * exported file carries the typefaces with it. Built-in fonts need no asset.
 */
async function collectFontAssets(theme: PresetTheme): Promise<{ fonts: PresetFontAsset[] } | undefined> {
  const { customFonts } = useAppStore.getState();
  const ids = new Set([theme.fontId, theme.terminalFontId]);
  const referenced = customFonts.filter((f) => ids.has(f.id));
  if (referenced.length === 0) return undefined;

  const fonts: PresetFontAsset[] = [];
  for (const custom of referenced) {
    try {
      const data = await invoke<string>("read_font", { fileName: custom.fileName });
      fonts.push({
        id: custom.id,
        name: custom.name,
        family: custom.family,
        fileName: custom.fileName,
        category: custom.category,
        data,
      });
    } catch {
      // Font missing on disk — export without it; import falls back to default.
    }
  }
  return fonts.length ? { fonts } : undefined;
}

/** Save imported font assets to disk and register them for immediate use. */
async function installFontAssets(assets: { fonts: PresetFontAsset[] } | undefined): Promise<void> {
  if (!assets?.fonts.length) return;
  const { addCustomFont } = useAppStore.getState();
  for (const font of assets.fonts) {
    try {
      const storedName = await invoke<string>("save_font", {
        fileName: font.fileName,
        data: font.data,
      });
      // Preserve the asset id so the preset's fontId still resolves.
      addCustomFont({
        id: font.id,
        name: font.name,
        family: font.family,
        fileName: storedName,
        category: font.category,
      });
      await registerCustomFont({ family: font.family, fileName: storedName }, font.data);
    } catch {
      // Skip a bad asset; the preset's fontId gracefully falls back to default.
    }
  }
}

// ── Tauri-file-backed persistence ────────────────────────────────────────────

const tauriFileStorage: StateStorage = {
  getItem: async () => {
    try {
      const raw = await readPresets();
      return raw && raw.length > 0 ? raw : null;
    } catch {
      return null; // Missing / unreadable → hydrate to an empty library.
    }
  },
  setItem: async (_name, value) => {
    try { await writePresets(value); } catch { /* best-effort persistence */ }
  },
  removeItem: async () => {
    try { await writePresets(""); } catch { /* ignore */ }
  },
};

// ── Store ────────────────────────────────────────────────────────────────────

interface LoomState {
  presets: ReterminaPreset[];

  /** Capture the live theme + workspace as a new named preset. */
  saveCurrentAsPreset: (name: string) => void;
  /** Re-hydrate the whole app from a saved preset. */
  loadPreset: (id: string) => void;
  /** Remove a preset from the library. */
  deletePreset: (id: string) => void;
  /** Write a preset to a user-chosen `.json` file (returns the path, or null if cancelled). */
  exportPreset: (id: string) => Promise<string | null>;
  /** Pick a `.json` Loom, validate, install assets, add it, and apply it. */
  importPreset: () => Promise<ReterminaPreset | null>;
  /**
   * Validate an already-parsed Loom document (e.g. fetched from the gallery),
   * install its fonts, add it to the library, and apply it. Shared by file
   * import and the marketplace.
   */
  installPreset: (raw: unknown) => Promise<ReterminaPreset | null>;
}

export const useLoomStore = create<LoomState>()(
  persist(
    (set, get) => ({
      presets: [],

      saveCurrentAsPreset: (name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const preset = buildPreset(trimmed, captureTheme(), captureWorkspace());
        set((s) => ({
          // Overwrite a same-named preset rather than duplicating it.
          presets: [preset, ...s.presets.filter((p) => p.name.toLowerCase() !== trimmed.toLowerCase())],
        }));
      },

      loadPreset: (id) => {
        const preset = get().presets.find((p) => p.id === id);
        if (preset) applyPreset(preset);
      },

      deletePreset: (id) =>
        set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),

      exportPreset: async (id) => {
        const preset = get().presets.find((p) => p.id === id);
        if (!preset) throw new Error("Preset not found.");

        const assets = await collectFontAssets(preset.theme);
        const doc: ReterminaPreset = assets ? { ...preset, assets } : preset;

        const suggested = `${preset.name.replace(/[^\w.-]+/g, "-")}.json`;
        const path = await saveDialog({
          defaultPath: suggested,
          filters: [{ name: "Retermina Loom", extensions: ["json"] }],
        });
        if (!path) return null; // User cancelled.

        await writeFile(path, JSON.stringify(doc, null, 2));
        return path;
      },

      importPreset: async () => {
        const selected = await openDialog({
          multiple: false,
          directory: false,
          filters: [{ name: "Retermina Loom", extensions: ["json"] }],
        });
        const path = Array.isArray(selected) ? selected[0] : selected;
        if (!path) return null; // User cancelled.

        const text = await readFile(path);
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Error("That file isn't valid JSON.");
        }
        return get().installPreset(parsed);
      },

      installPreset: async (raw) => {
        const preset = parsePreset(raw);
        if (!preset) throw new Error("That isn't a Retermina Loom preset.");

        // Bring any bundled fonts in first so the theme resolves on apply.
        await installFontAssets(preset.assets);

        // Give it a fresh id if it collides with an existing one, and strip the
        // embedded asset bytes — the font files now live on disk, so keeping the
        // base64 around would needlessly bloat presets.json.
        const exists = get().presets.some((p) => p.id === preset.id);
        const lean: ReterminaPreset = { ...preset };
        if (exists) lean.id = crypto.randomUUID();
        delete lean.assets;

        set((s) => ({ presets: [lean, ...s.presets] }));
        applyPreset(lean);
        return lean;
      },
    }),
    {
      name: "retermina-loom",
      version: PRESET_VERSION,
      storage: createJSONStorage(() => tauriFileStorage),
      partialize: (s) => ({ presets: s.presets }),
    },
  ),
);
