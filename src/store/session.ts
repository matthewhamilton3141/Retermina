import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Persists the file open in the Code panel across launches (its *path* only —
 * never its contents, and never any PTY/terminal buffer), so reopening the app
 * restores that file too. Cleared when the user navigates back to the Launch
 * Hub.
 *
 * Which view the app reopens to (Launch Hub vs. workspace) is persisted by the
 * app store's `view`; the workspace's tabs + panel layout by the persisted
 * `retermina.workspaces` store. `lastCwd` is kept here only to drop the open
 * file when the active folder changes (a file mustn't leak across workspaces).
 */
interface SessionState {
  lastCwd: string | null;
  /** Absolute path of the file last open in the Code panel, or null. */
  openFilePath: string | null;
  /** Record the active workspace. Drops the open file if the cwd changed. */
  save: (cwd: string) => void;
  /** Record (or clear) the file open in the Code panel. */
  saveOpenFile: (path: string | null) => void;
  clear: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      lastCwd: null,
      openFilePath: null,
      save: (cwd) =>
        set((s) => ({
          lastCwd: cwd,
          // A file from a different workspace must not leak across.
          openFilePath: s.lastCwd === cwd ? s.openFilePath : null,
        })),
      saveOpenFile: (path) => set({ openFilePath: path }),
      clear: () => set({ lastCwd: null, openFilePath: null }),
    }),
    { name: "retermina.last-session" },
  ),
);
