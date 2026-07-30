import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Submitted-prompt history, keyed by project (cwd) — mirrors Claude Code's
 * own history file (`~/.claude/history.jsonl`, one entry per submission,
 * scoped per project): every prompt/command actually sent at the composer
 * is recorded here, persists across restarts and conversations, and is
 * what the Agent view's ghost-text autosuggest draws from.
 */
interface PromptHistoryState {
  history: Record<string, string[]>;
  /** Record a submitted prompt for a project. No-ops on immediate repeats. */
  record: (cwd: string, text: string) => void;
}

const MAX_PER_PROJECT = 500;

export const usePromptHistoryStore = create<PromptHistoryState>()(
  persist(
    (set) => ({
      history: {},

      record: (cwd, text) =>
        set((state) => {
          const trimmed = text.trim();
          if (!trimmed) return state;
          const existing = state.history[cwd] ?? [];
          if (existing[existing.length - 1] === trimmed) return state;
          return {
            history: {
              ...state.history,
              [cwd]: [...existing, trimmed].slice(-MAX_PER_PROJECT),
            },
          };
        }),
    }),
    { name: "retermina.prompt-history" },
  ),
);
