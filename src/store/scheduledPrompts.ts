/**
 * Scheduled prompts — "time your prompts."
 *
 * Lets the user queue a prompt to fire into a workspace's Claude Code panel at a
 * chosen time (e.g. when their usage limit resets overnight). The runner
 * component polls this list and, when a prompt comes due, pastes + submits it
 * via {@link claudeBus} and pops a card over the workspace.
 *
 * Persisted so a queued prompt survives a reload — though firing needs the app
 * running at the due time (a sleeping machine pauses timers; the runner fires it
 * on the next check after wake, so a slightly-late fire is expected, not a miss).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ScheduledPromptStatus = "pending" | "done" | "failed";

export interface ScheduledPrompt {
  id: string;
  prompt: string;
  /** Absolute epoch ms at which it should fire. */
  fireAt: number;
  /**
   * Target tab whose Claude Code panel receives the prompt — the *primary*
   * target. If that tab is gone at fire time we fall back to any open tab on
   * the same {@link cwd}, so a prompt stays bound to its directory even if the
   * folder was closed and reopened in a fresh tab.
   */
  workspaceId: string;
  /** Directory this prompt is bound to (null = a blank/dirless terminal tab). */
  cwd: string | null;
  /** Tab label captured at creation, for the list UI. */
  workspaceLabel: string;
  status: ScheduledPromptStatus;
  createdAt: number;
  /** When it actually fired (epoch ms). */
  firedAt?: number;
  /** Whether a Claude panel was reachable at fire time. */
  delivered?: boolean;
}

interface ScheduleInput {
  prompt: string;
  fireAt: number;
  workspaceId: string;
  cwd: string | null;
  workspaceLabel: string;
}

interface ScheduledPromptsState {
  prompts: ScheduledPrompt[];
  /** Queue a prompt. Returns its id. */
  schedule: (input: ScheduleInput) => string;
  /** Remove a prompt (pending or finished). */
  remove: (id: string) => void;
  /** Mark a prompt as fired; `delivered` records whether Claude received it. */
  markFired: (id: string, delivered: boolean) => void;
  /** Drop every non-pending prompt. */
  clearFinished: () => void;
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `sp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const useScheduledPrompts = create<ScheduledPromptsState>()(
  persist(
    (set) => ({
      prompts: [],

      schedule: (input) => {
        const prompt: ScheduledPrompt = {
          id: newId(),
          prompt: input.prompt,
          fireAt: input.fireAt,
          workspaceId: input.workspaceId,
          cwd: input.cwd,
          workspaceLabel: input.workspaceLabel,
          status: "pending",
          createdAt: Date.now(),
        };
        set((s) => ({ prompts: [...s.prompts, prompt] }));
        return prompt.id;
      },

      remove: (id) => set((s) => ({ prompts: s.prompts.filter((p) => p.id !== id) })),

      markFired: (id, delivered) =>
        set((s) => ({
          prompts: s.prompts.map((p) =>
            p.id === id
              ? { ...p, status: delivered ? "done" : "failed", delivered, firedAt: Date.now() }
              : p,
          ),
        })),

      clearFinished: () => set((s) => ({ prompts: s.prompts.filter((p) => p.status === "pending") })),
    }),
    {
      name: "retermina.scheduled-prompts",
      version: 1,
    },
  ),
);

/** (today | tomorrow) + "HH:MM" → absolute epoch ms. */
export function computeFireAt(day: "today" | "tomorrow", timeHHMM: string): number {
  const [h, m] = timeHHMM.split(":").map((n) => parseInt(n, 10));
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  if (day === "tomorrow") d.setDate(d.getDate() + 1);
  return d.getTime();
}
