import { create } from "zustand";
import { persist } from "zustand/middleware";

import { DEFAULT_THEME_ID, isThemeId, type ThemeId } from "../lib/theme";
import { useRecentStore } from "./recent";

/** Which top-level screen is showing. */
export type AppView = "launch" | "workspace";

interface AppState {
  view: AppView;
  /** Working directory for the active workspace (null = blank terminal). */
  workspaceCwd: string | null;
  /** Active theme engine id (Step 5). */
  themeId: ThemeId;
  /** Open the Terminal Workspace, optionally rooted at a directory. */
  openTerminal: (cwd?: string | null) => void;
  /** Return to the Launch Hub. */
  goToLaunch: () => void;
  /** Switch the active theme engine. */
  setTheme: (id: ThemeId) => void;
}

/** Persisted schema version; bump when the persisted shape changes. */
export const APP_STATE_VERSION = 1;

/**
 * App-level store. Navigation (`view`/`workspaceCwd`) is intentionally session
 * state and resets to the Launch Hub on reload; only the chosen theme engine is
 * persisted so the user's look survives a restart.
 */
export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      view: "launch",
      workspaceCwd: null,
      themeId: DEFAULT_THEME_ID,
      openTerminal: (cwd = null) => {
        if (cwd) useRecentStore.getState().record(cwd);
        set({ view: "workspace", workspaceCwd: cwd });
      },
      goToLaunch: () => set({ view: "launch", workspaceCwd: null }),
      setTheme: (id) => set({ themeId: id }),
    }),
    {
      name: "retermina.app",
      version: APP_STATE_VERSION,
      // Persist only the theme; navigation should always start at the hub.
      partialize: (state) => ({ themeId: state.themeId }),
      // Reject an unknown/corrupt persisted theme and keep the default.
      merge: (persisted, current) => {
        const persistedTheme = (persisted as Partial<AppState> | undefined)
          ?.themeId;
        const themeId = isThemeId(persistedTheme)
          ? persistedTheme
          : current.themeId;
        return { ...current, themeId };
      },
    },
  ),
);
