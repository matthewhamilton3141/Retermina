import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  applyClaudeRecord,
  emptyClaudeTranscript,
  type ClaudePermissionMode,
  type ClaudeRunStatus,
  type ClaudeShellActivity,
  type ClaudeTimelineItem,
  type ClaudeTranscriptSnapshot,
} from "../lib/claudeTranscript";

export interface ClaudeLimitNotice {
  kind: "session" | "weekly";
  resetAt: number | null;
  detectedAt: number;
}

export interface ClaudeLiveSession extends ClaudeTranscriptSnapshot {
  sessionId: string;
  lastSubmittedPrompt: string;
  limit: ClaudeLimitNotice | null;
}

interface ClaudeSessionsState {
  sessions: Record<string, ClaudeLiveSession>;
  beginSession: (workspaceId: string, sessionId: string) => void;
  ingest: (workspaceId: string, sessionId: string, sourceId: string, record: unknown) => void;
  setStatus: (workspaceId: string, status: ClaudeRunStatus) => void;
  setPermissionMode: (workspaceId: string, permissionMode: ClaudePermissionMode) => void;
  setError: (workspaceId: string, error: string) => void;
  markSubmitted: (workspaceId: string, prompt: string) => void;
  markInterrupted: (workspaceId: string) => void;
  pushNotice: (workspaceId: string, text: string) => void;
  addShellItem: (workspaceId: string, item: ClaudeShellActivity) => void;
  updateShellItem: (
    workspaceId: string,
    id: string,
    patch: Partial<Pick<ClaudeShellActivity, "status" | "code" | "stdout" | "stderr">>,
  ) => void;
  setLimit: (workspaceId: string, limit: ClaudeLimitNotice | null) => void;
  removeSession: (workspaceId: string, sessionId: string) => void;
}

export const useClaudeSessions = create<ClaudeSessionsState>((set) => ({
  sessions: {},

  beginSession: (workspaceId, sessionId) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [workspaceId]: {
          ...emptyClaudeTranscript(),
          sessionId,
          lastSubmittedPrompt: state.sessions[workspaceId]?.lastSubmittedPrompt ?? "",
          limit: null,
        },
      },
    })),

  ingest: (workspaceId, sessionId, sourceId, record) =>
    set((state) => {
      const current = state.sessions[workspaceId];
      if (!current || current.sessionId !== sessionId) return state;
      const transcript = applyClaudeRecord(current, record, sourceId);
      return {
        sessions: {
          ...state.sessions,
          [workspaceId]: {
            ...current,
            ...transcript,
            status: current.limit ? "limited" : transcript.status,
          },
        },
      };
    }),

  setStatus: (workspaceId, status) =>
    set((state) => {
      const current = state.sessions[workspaceId];
      if (!current) return state;
      return {
        sessions: {
          ...state.sessions,
          [workspaceId]: { ...current, status },
        },
      };
    }),

  setPermissionMode: (workspaceId, permissionMode) =>
    set((state) => {
      const current = state.sessions[workspaceId];
      if (!current) return state;
      return {
        sessions: {
          ...state.sessions,
          [workspaceId]: { ...current, permissionMode },
        },
      };
    }),

  setError: (workspaceId, error) =>
    set((state) => {
      const current = state.sessions[workspaceId];
      if (!current) return state;
      return {
        sessions: {
          ...state.sessions,
          [workspaceId]: { ...current, error, status: "idle" },
        },
      };
    }),

  markSubmitted: (workspaceId, prompt) =>
    set((state) => {
      const current = state.sessions[workspaceId];
      if (!current) return state;
      return {
        sessions: {
          ...state.sessions,
          [workspaceId]: {
            ...current,
            lastSubmittedPrompt: prompt,
            limit: null,
            status: "running",
          },
        },
      };
    }),

  markInterrupted: (workspaceId) =>
    set((state) => {
      const current = state.sessions[workspaceId];
      if (!current) return state;
      // Optimistically reflect the interrupt on the agent side. Claude only
      // writes a `[Request interrupted by user]` record once it has actually
      // started a turn; a fast interrupt (before the prompt was even submitted)
      // never produces one, so the transcript would otherwise stay silent with
      // the "working" spinner stuck. Dedupe against a record that does arrive.
      const last = current.items[current.items.length - 1];
      const alreadyNoted = last?.kind === "notice" && last.text === "Interrupted";
      const items: ClaudeTimelineItem[] = alreadyNoted
        ? current.items
        : [
            ...current.items,
            {
              id: `local-interrupt-${Date.now()}`,
              kind: "notice",
              timestamp: Date.now(),
              text: "Interrupted",
              tone: "muted",
            },
          ];
      return {
        sessions: {
          ...state.sessions,
          [workspaceId]: { ...current, items, status: "idle" },
        },
      };
    }),

  pushNotice: (workspaceId, text) =>
    set((state) => {
      const current = state.sessions[workspaceId];
      if (!current) return state;
      const item: ClaudeTimelineItem = {
        id: `local-notice-${Date.now()}`,
        kind: "notice",
        timestamp: Date.now(),
        text,
        tone: "muted",
      };
      return {
        sessions: {
          ...state.sessions,
          [workspaceId]: { ...current, items: [...current.items, item] },
        },
      };
    }),

  addShellItem: (workspaceId, item) =>
    set((state) => {
      const current = state.sessions[workspaceId];
      if (!current) return state;
      return {
        sessions: {
          ...state.sessions,
          [workspaceId]: { ...current, items: [...current.items, item] },
        },
      };
    }),

  updateShellItem: (workspaceId, id, patch) =>
    set((state) => {
      const current = state.sessions[workspaceId];
      if (!current) return state;
      const items = current.items.map((item) =>
        item.kind === "shell" && item.id === id ? { ...item, ...patch } : item,
      );
      return {
        sessions: { ...state.sessions, [workspaceId]: { ...current, items } },
      };
    }),

  setLimit: (workspaceId, limit) =>
    set((state) => {
      const current = state.sessions[workspaceId];
      if (!current) return state;
      return {
        sessions: {
          ...state.sessions,
          [workspaceId]: {
            ...current,
            limit,
            status: limit ? "limited" : "idle",
          },
        },
      };
    }),

  removeSession: (workspaceId, sessionId) =>
    set((state) => {
      if (state.sessions[workspaceId]?.sessionId !== sessionId) return state;
      const sessions = { ...state.sessions };
      delete sessions[workspaceId];
      return { sessions };
    }),
}));

export type ClaudePanelView = "agent" | "cli";
/**
 * The value passed to `claude --model`. `"default"` is the sentinel for "leave
 * the flag off" (use Claude Code's own setting); any other string is either an
 * alias (`opus`, `sonnet`, `haiku`, `fable`) or a pinned version id
 * (`claude-opus-4-8`, …). Free-form so new versions don't require a code change.
 */
export type ClaudeModelChoice = string;

export interface ClaudeWorkspacePreference {
  view: ClaudePanelView;
  draft: string;
  permissionMode: ClaudePermissionMode;
  model: ClaudeModelChoice;
}

interface ClaudeWorkspacePreferencesState {
  workspaces: Record<string, ClaudeWorkspacePreference>;
  setView: (workspaceId: string, view: ClaudePanelView) => void;
  setDraft: (workspaceId: string, draft: string) => void;
  setPermissionMode: (workspaceId: string, permissionMode: ClaudePermissionMode) => void;
  setModel: (workspaceId: string, model: ClaudeModelChoice) => void;
}

const DEFAULT_PREFERENCE: ClaudeWorkspacePreference = {
  view: "agent",
  draft: "",
  // The stream-json agent runs headless, where "default" blocks every tool that
  // needs approval (there is no interactive prompt). Auto-accept lets a fresh
  // agent actually do work; the user can dial down to Plan or up to Full access.
  permissionMode: "acceptEdits",
  model: "default",
};

const preference = (
  current: ClaudeWorkspacePreference | undefined,
): ClaudeWorkspacePreference => ({ ...DEFAULT_PREFERENCE, ...current });

/** Small persisted UI state only; transcript content remains in Claude's JSONL. */
export const useClaudeWorkspacePreferences = create<ClaudeWorkspacePreferencesState>()(
  persist(
    (set) => ({
      workspaces: {},
      setView: (workspaceId, view) =>
        set((state) => ({
          workspaces: {
            ...state.workspaces,
            [workspaceId]: { ...preference(state.workspaces[workspaceId]), view },
          },
        })),
      setDraft: (workspaceId, draft) =>
        set((state) => ({
          workspaces: {
            ...state.workspaces,
            [workspaceId]: { ...preference(state.workspaces[workspaceId]), draft },
          },
        })),
      setPermissionMode: (workspaceId, permissionMode) =>
        set((state) => ({
          workspaces: {
            ...state.workspaces,
            [workspaceId]: {
              ...preference(state.workspaces[workspaceId]),
              permissionMode,
            },
          },
        })),
      setModel: (workspaceId, model) =>
        set((state) => ({
          workspaces: {
            ...state.workspaces,
            [workspaceId]: { ...preference(state.workspaces[workspaceId]), model },
          },
        })),
    }),
    {
      name: "retermina.claude-workspaces",
      version: 1,
    },
  ),
);

export function claudeWorkspacePreference(workspaceId: string): ClaudeWorkspacePreference {
  return preference(useClaudeWorkspacePreferences.getState().workspaces[workspaceId]);
}
