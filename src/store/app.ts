import { create } from "zustand";
import { persist } from "zustand/middleware";

import { DEFAULT_THEME_ID, isThemeId, type ThemeId } from "../lib/theme";
import { DEFAULT_CUSTOM_GRADIENT, sanitizeGradient, type CustomGradient } from "../lib/gradient";
import { THEME_FONT_CATEGORY, TERMINAL_FONT_SIZE, fontIdForCategory } from "../lib/fonts";
import { useRecentStore } from "./recent";
import { useSessionStore } from "./session";
import { useWorkspacesStore } from "./workspaces";

export type AppView = "launch" | "workspace";
export type ToolbarStyle = "dropdown" | "icons";
export type TopBarStyle  = "icon-only" | "icon-and-text";
/** Motion policy: follow the OS, force motion on, or force reduced motion. */
export type MotionPreference = "system" | "full" | "reduced";
/**
 * Workspace backdrop: flat color, an accent-derived gradient, a mesh of accent
 * blobs, or a fully user-defined gradient (see `customBackdrop`).
 */
export type BackdropStyle = "solid" | "gradient" | "mesh" | "custom";

export interface CustomTheme {
  id: string;
  name: string;
  /** Base theme applied before overrides. */
  baseThemeId: ThemeId;
  accentColor: string;
}

export interface CustomFont {
  /** Stable id — also used as the value for `fontId` when this font is active. */
  id: string;
  /** Display name shown in the picker. */
  name: string;
  /** Unique CSS family name registered via the FontFace API. */
  family: string;
  /** File name as stored on disk under <data_dir>/Retermina/fonts. */
  fileName: string;
  /** Thematic category this font is assigned to. */
  category: string;
}

interface AppState {
  view: AppView;
  workspaceCwd: string | null;
  /** Whether the Settings modal is open (ephemeral — never persisted). */
  settingsOpen: boolean;
  themeId: ThemeId;
  toolbarStyle: ToolbarStyle;
  topBarStyle: TopBarStyle;
  accentColor: string | null;
  fontId: string;
  /** Terminal monospace typeface id (built-in mono, uploaded font, or default). */
  terminalFontId: string;
  /** Terminal font size in px (clamped to TERMINAL_FONT_SIZE bounds). */
  terminalFontSize: number;
  /** When true, switching theme also swaps the font to the theme's category. */
  autoPairFont: boolean;
  /** Global workspace text scale as a percentage (80–130). */
  uiScale: number;
  /** Whether to follow the OS reduce-motion setting or force it on/off. */
  motionPreference: MotionPreference;
  /** Strengthen borders + text contrast across every theme. */
  highContrast: boolean;
  /** Disable frosted-glass blur / translucency for legibility. */
  reduceTransparency: boolean;
  /** Whether the terminal cursor blinks. */
  terminalCursorBlink: boolean;
  /** Workspace backdrop style. */
  backdropStyle: BackdropStyle;
  /** The user-defined gradient used when backdropStyle is "custom". */
  customBackdrop: CustomGradient;
  customThemes: CustomTheme[];
  customFonts: CustomFont[];

  setSettingsOpen: (open: boolean) => void;
  openTerminal: (cwd?: string | null) => void;
  goToLaunch: () => void;
  setTheme: (id: ThemeId) => void;
  setToolbarStyle: (style: ToolbarStyle) => void;
  setTopBarStyle: (style: TopBarStyle) => void;
  setAccentColor: (color: string | null) => void;
  setFontId: (id: string) => void;
  setTerminalFontId: (id: string) => void;
  setTerminalFontSize: (size: number) => void;
  setAutoPairFont: (on: boolean) => void;
  setUiScale: (scale: number) => void;
  setMotionPreference: (pref: MotionPreference) => void;
  setHighContrast: (on: boolean) => void;
  setReduceTransparency: (on: boolean) => void;
  setTerminalCursorBlink: (on: boolean) => void;
  setBackdropStyle: (style: BackdropStyle) => void;
  setCustomBackdrop: (gradient: CustomGradient) => void;
  saveCustomTheme: (name: string) => void;
  removeCustomTheme: (id: string) => void;
  addCustomFont: (font: CustomFont) => void;
  removeCustomFont: (id: string) => void;
}

// Bumping this discards persisted settings (no migrate fn), so it stays at 1:
// new fields like `customFonts` are additive and handled by `merge` below.
export const APP_STATE_VERSION = 1;

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      view: "launch",
      workspaceCwd: null,
      settingsOpen: false,
      themeId: DEFAULT_THEME_ID,
      toolbarStyle: "dropdown",
      topBarStyle: "icon-only",
      accentColor: null,
      fontId: "default",
      terminalFontId: "default",
      terminalFontSize: TERMINAL_FONT_SIZE.default,
      autoPairFont: false,
      uiScale: 100,
      motionPreference: "system",
      highContrast: false,
      reduceTransparency: false,
      terminalCursorBlink: true,
      backdropStyle: "solid",
      customBackdrop: DEFAULT_CUSTOM_GRADIENT,
      customThemes: [],
      customFonts: [],

      setSettingsOpen: (open) => set({ settingsOpen: open }),
      openTerminal: (cwd = null) => {
        if (cwd) {
          useRecentStore.getState().record(cwd);
          useSessionStore.getState().save(cwd);
        }
        // Open (or focus an existing) workspace tab for this folder. Each tab
        // keeps its own terminals running even while backgrounded.
        useWorkspacesStore.getState().openWorkspace(cwd);
        set({ view: "workspace", workspaceCwd: cwd });
      },
      goToLaunch: () => {
        useSessionStore.getState().clear();
        // Tabs are intentionally left intact so returning to a workspace keeps
        // the user's open folders; only the view changes.
        set({ view: "launch", workspaceCwd: null });
      },
      setTheme: (id) => {
        set({ themeId: id });
        // Auto-pair: adopt the font categorized for this theme, if enabled.
        if (get().autoPairFont) {
          const category = THEME_FONT_CATEGORY[id];
          const match = category ? fontIdForCategory(category, get().customFonts) : null;
          if (match) set({ fontId: match });
        }
      },
      setToolbarStyle: (style) => set({ toolbarStyle: style }),
      setTopBarStyle: (style) => set({ topBarStyle: style }),
      setAccentColor: (color) => set({ accentColor: color }),
      setFontId: (id) => set({ fontId: id }),
      setTerminalFontId: (id) => set({ terminalFontId: id }),
      setTerminalFontSize: (size) =>
        set({
          terminalFontSize: Math.max(
            TERMINAL_FONT_SIZE.min,
            Math.min(TERMINAL_FONT_SIZE.max, Math.round(size)),
          ),
        }),
      setAutoPairFont: (on) => {
        set({ autoPairFont: on });
        // Turning it on immediately pairs the current theme's font.
        if (on) {
          const category = THEME_FONT_CATEGORY[get().themeId];
          const match = category ? fontIdForCategory(category, get().customFonts) : null;
          if (match) set({ fontId: match });
        }
      },
      setUiScale: (scale) => set({ uiScale: Math.max(80, Math.min(130, Math.round(scale))) }),
      setMotionPreference: (pref) => set({ motionPreference: pref }),
      setHighContrast: (on) => set({ highContrast: on }),
      setReduceTransparency: (on) => set({ reduceTransparency: on }),
      setTerminalCursorBlink: (on) => set({ terminalCursorBlink: on }),
      setBackdropStyle: (style) => set({ backdropStyle: style }),
      setCustomBackdrop: (gradient) => set({ customBackdrop: gradient }),

      saveCustomTheme: (name) => {
        const { themeId, accentColor } = get();
        const id = `custom-${Date.now()}`;
        set((s) => ({
          customThemes: [
            { id, name, baseThemeId: themeId, accentColor: accentColor ?? "#10b981" },
            ...s.customThemes.filter((t) => t.name !== name), // overwrite same name
          ],
        }));
      },

      removeCustomTheme: (id) =>
        set((s) => ({ customThemes: s.customThemes.filter((t) => t.id !== id) })),

      addCustomFont: (font) =>
        set((s) => ({
          customFonts: [font, ...s.customFonts.filter((f) => f.id !== font.id)],
        })),

      removeCustomFont: (id) =>
        set((s) => ({
          customFonts: s.customFonts.filter((f) => f.id !== id),
          // If the removed font was active, fall back to the system default.
          fontId: s.fontId === id ? "default" : s.fontId,
        })),
    }),
    {
      name: "retermina.app",
      version: APP_STATE_VERSION,
      partialize: (s) => ({
        // Persisted so launching the app returns to wherever you left off — the
        // workspace (with its tabs/layout restored by retermina.workspaces) or
        // the Launch Hub. goToLaunch sets this to "launch", so quitting from the
        // hub still reopens on the hub.
        view: s.view,
        themeId: s.themeId,
        toolbarStyle: s.toolbarStyle,
        topBarStyle: s.topBarStyle,
        accentColor: s.accentColor,
        fontId: s.fontId,
        terminalFontId: s.terminalFontId,
        terminalFontSize: s.terminalFontSize,
        autoPairFont: s.autoPairFont,
        uiScale: s.uiScale,
        motionPreference: s.motionPreference,
        highContrast: s.highContrast,
        reduceTransparency: s.reduceTransparency,
        terminalCursorBlink: s.terminalCursorBlink,
        backdropStyle: s.backdropStyle,
        customBackdrop: s.customBackdrop,
        customThemes: s.customThemes,
        customFonts: s.customFonts,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<AppState> | undefined;
        const view: AppView = p?.view === "workspace" || p?.view === "launch" ? p.view : current.view;
        const themeId = isThemeId(p?.themeId) ? p!.themeId : current.themeId;
        const toolbarStyle: ToolbarStyle =
          p?.toolbarStyle === "dropdown" || p?.toolbarStyle === "icons"
            ? p.toolbarStyle : current.toolbarStyle;
        const topBarStyle: TopBarStyle =
          p?.topBarStyle === "icon-only" || p?.topBarStyle === "icon-and-text"
            ? p.topBarStyle : current.topBarStyle;
        const accentColor =
          typeof p?.accentColor === "string" ? p.accentColor
          : p?.accentColor === null ? null
          : current.accentColor;
        const fontId = typeof p?.fontId === "string" ? p.fontId : current.fontId;
        const terminalFontId = typeof p?.terminalFontId === "string" ? p.terminalFontId : current.terminalFontId;
        const terminalFontSize =
          typeof p?.terminalFontSize === "number"
            ? Math.max(TERMINAL_FONT_SIZE.min, Math.min(TERMINAL_FONT_SIZE.max, Math.round(p.terminalFontSize)))
            : current.terminalFontSize;
        const autoPairFont = typeof p?.autoPairFont === "boolean" ? p.autoPairFont : current.autoPairFont;
        const uiScale = typeof p?.uiScale === "number" ? p.uiScale : current.uiScale;
        const motionPreference: MotionPreference =
          p?.motionPreference === "system" || p?.motionPreference === "full" || p?.motionPreference === "reduced"
            ? p.motionPreference : current.motionPreference;
        const highContrast = typeof p?.highContrast === "boolean" ? p.highContrast : current.highContrast;
        const reduceTransparency = typeof p?.reduceTransparency === "boolean" ? p.reduceTransparency : current.reduceTransparency;
        const terminalCursorBlink = typeof p?.terminalCursorBlink === "boolean" ? p.terminalCursorBlink : current.terminalCursorBlink;
        const backdropStyle: BackdropStyle =
          p?.backdropStyle === "solid" || p?.backdropStyle === "gradient" ||
          p?.backdropStyle === "mesh" || p?.backdropStyle === "custom"
            ? p.backdropStyle : current.backdropStyle;
        const customBackdrop = sanitizeGradient(p?.customBackdrop) ?? current.customBackdrop;
        const customThemes = Array.isArray(p?.customThemes) ? p!.customThemes : current.customThemes;
        const customFonts = Array.isArray(p?.customFonts) ? p!.customFonts : current.customFonts;
        return { ...current, view, themeId, toolbarStyle, topBarStyle, accentColor, fontId, terminalFontId, terminalFontSize, autoPairFont, uiScale, motionPreference, highContrast, reduceTransparency, terminalCursorBlink, backdropStyle, customBackdrop, customThemes, customFonts };
      },
    },
  ),
);
