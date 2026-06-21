import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Persists the last active workspace cwd so the app can auto-reconnect
 * on next launch. Cleared when the user explicitly navigates back to the
 * Launch Hub (so restarting after that lands on the hub, not the workspace).
 */
interface SessionState {
  lastCwd: string | null;
  save:  (cwd: string) => void;
  clear: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      lastCwd: null,
      save:  (cwd)  => set({ lastCwd: cwd }),
      clear: ()     => set({ lastCwd: null }),
    }),
    { name: "retermina.last-session" },
  ),
);
