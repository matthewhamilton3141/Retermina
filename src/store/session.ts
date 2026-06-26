import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Persists the last active session so the app can auto-reconnect on next
 * launch: the workspace cwd and the file open in the Code panel (its *path*
 * only — never its contents, and never any PTY/terminal buffer). Cleared when
 * the user explicitly navigates back to the Launch Hub, so restarting after
 * that lands on the hub, not the workspace.
 *
 * The panel layout itself is restored separately by the persisted
 * `retermina.workspace-layout` store, so this only needs to carry the bits
 * that store doesn't: which folder, and which file.
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
