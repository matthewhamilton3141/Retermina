import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface RecentEntry {
  path: string;
  /** Last path component used as the display name. */
  name: string;
  /** Unix ms timestamp of the last open. */
  openedAt: number;
}

interface RecentState {
  entries: RecentEntry[];
  /** Record a folder being opened. Moves it to the top if already present. */
  record: (path: string) => void;
  /** Remove one entry by path. */
  remove: (path: string) => void;
  /** Wipe all history. */
  clear: () => void;
}

const MAX_ENTRIES = 20;

export const useRecentStore = create<RecentState>()(
  persist(
    (set) => ({
      entries: [],

      record: (path) =>
        set((state) => {
          const name = path.split("/").filter(Boolean).pop() ?? path;
          const filtered = state.entries.filter((e) => e.path !== path);
          return {
            entries: [
              { path, name, openedAt: Date.now() },
              ...filtered,
            ].slice(0, MAX_ENTRIES),
          };
        }),

      remove: (path) =>
        set((state) => ({
          entries: state.entries.filter((e) => e.path !== path),
        })),

      clear: () => set({ entries: [] }),
    }),
    { name: "retermina.recent-workspaces" },
  ),
);
