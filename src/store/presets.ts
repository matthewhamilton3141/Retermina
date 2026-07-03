import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  sanitizeGridItem,
  type WorkspaceGridItem,
  type WorkspacePanel,
} from "../lib/workspaceLayout";

export interface WorkspacePreset {
  id: string;
  name: string;
  panels: WorkspacePanel[];
  grid: WorkspaceGridItem[];
  createdAt: number;
}

interface PresetsState {
  presets: WorkspacePreset[];
  /** Save the current layout as a named preset. Overwrites if name already exists. */
  save: (name: string, panels: WorkspacePanel[], grid: WorkspaceGridItem[]) => void;
  /** Delete a preset by id. */
  remove: (id: string) => void;
  /** Rename an existing preset. */
  rename: (id: string, name: string) => void;
  /** Merge in presets recovered from the Loom library (reverse migration). */
  adopt: (presets: WorkspacePreset[]) => void;
}

export const usePresetsStore = create<PresetsState>()(
  persist(
    (set) => ({
      presets: [],

      save: (name, panels, grid) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set((state) => {
          const id = crypto.randomUUID();
          const entry: WorkspacePreset = {
            id,
            name: trimmed,
            panels,
            grid: grid.map(sanitizeGridItem),
            createdAt: Date.now(),
          };
          // Replace if a preset with the same name already exists.
          const filtered = state.presets.filter(
            (p) => p.name.toLowerCase() !== trimmed.toLowerCase(),
          );
          return { presets: [entry, ...filtered] };
        });
      },

      remove: (id) =>
        set((state) => ({
          presets: state.presets.filter((p) => p.id !== id),
        })),

      rename: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set((state) => ({
          presets: state.presets.map((p) =>
            p.id === id ? { ...p, name: trimmed } : p,
          ),
        }));
      },

      adopt: (incoming) =>
        set((state) => {
          if (incoming.length === 0) return state;
          const existing = new Set(state.presets.map((p) => p.id));
          const added = incoming.filter((p) => !existing.has(p.id));
          if (added.length === 0) return state;
          return { presets: [...state.presets, ...added] };
        }),
    }),
    { name: "retermina.workspace-presets" },
  ),
);
