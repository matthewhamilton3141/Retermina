/**
 * Persisted keyboard-binding overrides.
 *
 * Only *overrides* are stored (commandId → chord, or null when the user has
 * explicitly unbound a command). Anything absent resolves to the command's
 * default from lib/keybindings, so future default changes still reach users
 * who never customized that command.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { COMMAND_BY_ID, COMMANDS, type CommandId } from "../lib/keybindings";

interface KeybindingsState {
  /** Sparse map of explicit overrides; `null` means "unbound". */
  overrides: Partial<Record<CommandId, string | null>>;
  /** Rebind a command. Any other command holding the same chord is unbound. */
  setBinding: (id: CommandId, chord: string) => void;
  /** Explicitly clear a command's binding (so it does nothing). */
  unbind: (id: CommandId) => void;
  /** Drop the override, reverting the command to its default chord. */
  resetBinding: (id: CommandId) => void;
  /** Revert every command to its default. */
  resetAll: () => void;
}

export const useKeybindingsStore = create<KeybindingsState>()(
  persist(
    (set) => ({
      overrides: {},
      setBinding: (id, chord) =>
        set((s) => {
          const next: Partial<Record<CommandId, string | null>> = { ...s.overrides, [id]: chord };
          // Keep chords unique: unbind any *other* command currently resolving
          // to this chord, so the same keystroke never maps to two actions.
          for (const cmd of COMMANDS) {
            if (cmd.id === id) continue;
            const resolved = cmd.id in next ? next[cmd.id] : cmd.defaultBinding;
            if (resolved === chord) next[cmd.id] = null;
          }
          return { overrides: next };
        }),
      unbind: (id) => set((s) => ({ overrides: { ...s.overrides, [id]: null } })),
      resetBinding: (id) =>
        set((s) => {
          const next = { ...s.overrides };
          delete next[id];
          return { overrides: next };
        }),
      resetAll: () => set({ overrides: {} }),
    }),
    { name: "retermina.keybindings" },
  ),
);

/** Resolve a command's effective chord (override wins; null = unbound). */
export function resolveBinding(
  id: CommandId,
  overrides: Partial<Record<CommandId, string | null>>,
): string | null {
  return id in overrides ? overrides[id]! : COMMAND_BY_ID[id].defaultBinding;
}

/** Build a chord → commandId lookup from the current overrides, for matching. */
export function buildChordMap(
  overrides: Partial<Record<CommandId, string | null>>,
): Map<string, CommandId> {
  const map = new Map<string, CommandId>();
  for (const cmd of COMMANDS) {
    const chord = resolveBinding(cmd.id, overrides);
    if (chord) map.set(chord, cmd.id);
  }
  return map;
}
