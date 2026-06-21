import { create } from "zustand";
import { persist } from "zustand/middleware";

import { DEFAULT_THEME_ID, isThemeId, type ThemeId } from "../lib/theme";
import { useRecentStore } from "./recent";
import { useSessionStore } from "./session";

/** Which top-level screen is showing. */
export type AppView = "launch" | "workspace";

/** How the panel toggles are displayed in the workspace toolbar. */
export type ToolbarStyle = "dropdown" | "icons";

interface AppState {
  view: AppView;
  /** Working directory for the active workspace (null = blank terminal). */
  workspaceCwd: string | null;
  /** Active theme engine id. */
  themeId: ThemeId;
  /** How panel toggles appear in the toolbar. */
  toolbarStyle: ToolbarStyle;
  /** Open the Terminal Workspace, optionally rooted at a directory. */
  openTerminal: (cwd?: string | null) => void;
  /** Return to the Launch Hub. */
  goToLaunch: () => void;
  /** Switch the active theme engine. */
  setTheme: (id: ThemeId) => void;
  /** Switch the toolbar style. */
  setToolbarStyle: (style: ToolbarStyle) => void;
}

/** Persisted schema version; bump when the persisted shape changes. */
export const APP_STATE_VERSION = 1;

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      view: "launch",
      workspaceCwd: null,
      themeId: DEFAULT_THEME_ID,
      toolbarStyle: "dropdown",
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
    }),
    {
      name: "retermina.app",
      version: APP_STATE_VERSION,
      partialize: (state) => ({ themeId: state.themeId, toolbarStyle: state.toolbarStyle }),
      merge: (persisted, current) => {
        const p = persisted as Partial<AppState> | undefined;
        const themeId = isThemeId(p?.themeId) ? p!.themeId : current.themeId;
        const toolbarStyle: ToolbarStyle =
          p?.toolbarStyle === "dropdown" || p?.toolbarStyle === "icons"
            ? p.toolbarStyle
            : current.toolbarStyle;
        return { ...current, themeId, toolbarStyle };
      },
    },
  ),
);
