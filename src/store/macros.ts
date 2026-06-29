/**
 * User-defined Iris macros.
 *
 * Persisted to localStorage. Each macro is a title + match keywords + a shell
 * command line; Iris merges them into its catalog (always available, run as
 * typed) via `buildSuggestions({ userMacros })`.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { UserMacro } from "../lib/iris";

interface MacrosState {
  macros: UserMacro[];
  /** Add a macro (title + command required); returns its id. */
  addMacro: (m: Omit<UserMacro, "id">) => string;
  updateMacro: (id: string, patch: Partial<Omit<UserMacro, "id">>) => void;
  removeMacro: (id: string) => void;
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `macro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const useMacrosStore = create<MacrosState>()(
  persist(
    (set) => ({
      macros: [],
      addMacro: (m) => {
        const id = newId();
        set((s) => ({ macros: [...s.macros, { ...m, id }] }));
        return id;
      },
      updateMacro: (id, patch) =>
        set((s) => ({ macros: s.macros.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
      removeMacro: (id) => set((s) => ({ macros: s.macros.filter((m) => m.id !== id) })),
    }),
    { name: "retermina.macros" },
  ),
);
