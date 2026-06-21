import { create } from "zustand";
import { persist } from "zustand/middleware";

import { DEFAULT_THEME_ID, isThemeId, type ThemeId } from "../lib/theme";
import { useRecentStore } from "./recent";
import { useSessionStore } from "./session";

export type AppView = "launch" | "workspace";
export type ToolbarStyle = "dropdown" | "icons";
export type TopBarStyle  = "icon-only" | "icon-and-text";

export interface CustomTheme {
  id: string;
  name: string;
  /** Base theme applied before overrides. */
  baseThemeId: ThemeId;
  accentColor: string;
}

interface AppState {
  view: AppView;
  workspaceCwd: string | null;
  themeId: ThemeId;
  toolbarStyle: ToolbarStyle;
  topBarStyle: TopBarStyle;
  accentColor: string | null;
  fontId: string;
  customThemes: CustomTheme[];

  openTerminal: (cwd?: string | null) => void;
  goToLaunch: () => void;
  setTheme: (id: ThemeId) => void;
  setToolbarStyle: (style: ToolbarStyle) => void;
  setTopBarStyle: (style: TopBarStyle) => void;
  setAccentColor: (color: string | null) => void;
  setFontId: (id: string) => void;
  saveCustomTheme: (name: string) => void;
  removeCustomTheme: (id: string) => void;
}

export const APP_STATE_VERSION = 1;

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      view: "launch",
      workspaceCwd: null,
      themeId: DEFAULT_THEME_ID,
      toolbarStyle: "dropdown",
      topBarStyle: "icon-only",
      accentColor: null,
      fontId: "default",
      customThemes: [],

      openTerminal: (cwd = null) => {
        if (cwd) {
          useRecentStore.getState().record(cwd);
          useSessionStore.getState().save(cwd);
        }
        set({ view: "workspace", workspaceCwd: cwd });
      },
      goToLaunch: () => {
        useSessionStore.getState().clear();
        set({ view: "launch", workspaceCwd: null });
      },
      setTheme: (id) => set({ themeId: id }),
      setToolbarStyle: (style) => set({ toolbarStyle: style }),
      setTopBarStyle: (style) => set({ topBarStyle: style }),
      setAccentColor: (color) => set({ accentColor: color }),
      setFontId: (id) => set({ fontId: id }),

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
    }),
    {
      name: "retermina.app",
      version: APP_STATE_VERSION,
      partialize: (s) => ({
        themeId: s.themeId,
        toolbarStyle: s.toolbarStyle,
        topBarStyle: s.topBarStyle,
        accentColor: s.accentColor,
        fontId: s.fontId,
        customThemes: s.customThemes,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<AppState> | undefined;
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
        const customThemes = Array.isArray(p?.customThemes) ? p!.customThemes : current.customThemes;
        return { ...current, themeId, toolbarStyle, topBarStyle, accentColor, fontId, customThemes };
      },
    },
  ),
);
