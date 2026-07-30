import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Maps a terminal panel to the **host session id** of the live PTY it owns, so a
 * relaunched app can reattach to a shell that outlived the previous process (see
 * `session_host` on the Rust side).
 *
 * Keyed by `${tabId}:${panelId}` — the same identity the workspace store uses
 * for panels, so closing a panel/tab can find and drop the mapping. Persisted to
 * its own localStorage key (never mixed into `retermina.workspaces`).
 *
 * A mapping is only a *hint*: on reattach the host may report the session gone
 * (reaped past its grace window, or the host itself restarted), in which case
 * the caller drops the mapping and creates a fresh session instead. Intentional
 * closes drop the mapping eagerly so a closed terminal never resurrects.
 */
interface PtySessionsState {
  map: Record<string, string>;
  /** Host session id previously recorded for this panel, if any. */
  lookup: (key: string) => string | undefined;
  /** Record the host session id a panel is now bound to. */
  remember: (key: string, sessionId: string) => void;
  /** Forget one panel's mapping. */
  forget: (key: string) => void;
  /** Forget every mapping belonging to a tab (whole-tab close). */
  forgetTab: (tabId: string) => void;
}

export const usePtySessionsStore = create<PtySessionsState>()(
  persist(
    (set, get) => ({
      map: {},
      lookup: (key) => get().map[key],
      remember: (key, sessionId) =>
        set((s) => ({ map: { ...s.map, [key]: sessionId } })),
      forget: (key) =>
        set((s) => {
          if (!(key in s.map)) return s;
          const { [key]: _dropped, ...rest } = s.map;
          return { map: rest };
        }),
      forgetTab: (tabId) =>
        set((s) => ({
          map: Object.fromEntries(
            Object.entries(s.map).filter(([k]) => !k.startsWith(`${tabId}:`)),
          ),
        })),
    }),
    { name: "retermina.pty-sessions" },
  ),
);

/** Build the mapping key for a terminal panel. */
export const ptySessionKey = (tabId: string, panelId: string) => `${tabId}:${panelId}`;
