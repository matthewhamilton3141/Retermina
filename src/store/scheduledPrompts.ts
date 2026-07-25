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

export interface ScheduleDraft {
  prompt: string;
  /** Null when Claude reported a limit but no reset time could be parsed. */
  fireAt: number | null;
  workspaceId: string;
  cwd: string | null;
  workspaceLabel: string;
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

interface ScheduleDraftState {
  draft: ScheduleDraft | null;
  openDraft: (draft: ScheduleDraft) => void;
  clearDraft: () => void;
}

/** Transient hand-off used to open ScheduleMenu from a workspace panel. */
export const useScheduleDraft = create<ScheduleDraftState>((set) => ({
  draft: null,
  openDraft: (draft) => set({ draft }),
  clearDraft: () => set({ draft: null }),
}));

/** (today | tomorrow) + "HH:MM" → absolute epoch ms. */
export function computeFireAt(day: "today" | "tomorrow", timeHHMM: string): number {
  const [h, m] = timeHHMM.split(":").map((n) => parseInt(n, 10));
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  if (day === "tomorrow") d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Epoch milliseconds → local `<input type="datetime-local">` value. */
export function toLocalDateTimeInput(timestamp: number): string {
  const date = new Date(timestamp);
  const part = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}

/** Local `<input type="datetime-local">` value → epoch milliseconds. */
export function fromLocalDateTimeInput(value: string): number {
  if (!value) return Number.NaN;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function defaultScheduleAt(now = Date.now()): number {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  date.setSeconds(0, 0);
  return date.getTime();
}
