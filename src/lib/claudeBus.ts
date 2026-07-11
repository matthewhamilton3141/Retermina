/**
 * A per-workspace registry that lets a Terminal panel hand text to the Claude
 * Code panel in the *same* tab.
 *
 * The Claude Code panel runs its own dedicated `claude` session and stays off
 * the {@link terminalBus} (which tracks the single terminal Iris drives). To
 * "send last output to Claude" we need a separate channel: each Claude panel
 * registers a paste handle here keyed by its workspace id, and the Terminal
 * panel in that workspace looks it up. Module state (not React) so writing to
 * Claude never re-renders either memoized panel.
 */
import { useSyncExternalStore } from "react";

/** A handle to a workspace's Claude Code session. */
export interface ClaudeTarget {
  /** Insert text into Claude's prompt as a bracketed paste (no submit). */
  paste: (text: string) => void;
  /** Focus the Claude terminal so the user can add a question and hit Enter. */
  focus: () => void;
  /** Submit whatever is in Claude's prompt (press Enter). */
  submit: () => void;
}

const targets = new Map<string, ClaudeTarget>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export const claudeBus = {
  /** Register (or replace) the Claude target for a workspace. */
  set(workspaceId: string, target: ClaudeTarget) {
    targets.set(workspaceId, target);
    emit();
  },
  /** Remove a workspace's Claude target (on panel unmount). */
  clear(workspaceId: string) {
    if (targets.delete(workspaceId)) emit();
  },
  /** Whether a Claude Code panel is live in this workspace. */
  has(workspaceId: string) {
    return targets.has(workspaceId);
  },
  /**
   * Paste `text` into the workspace's Claude panel and focus it. Returns false
   * when no Claude Code panel is open in that workspace.
   */
  send(workspaceId: string, text: string): boolean {
    const target = targets.get(workspaceId);
    if (!target) return false;
    target.paste(text);
    target.focus();
    return true;
  },
  /**
   * Paste `text` and submit it (Enter) — used by scheduled prompts that fire
   * unattended. The Enter is delayed a beat so the bracketed paste registers in
   * Claude's input first. Returns false when no Claude panel is open.
   */
  run(workspaceId: string, text: string): boolean {
    const target = targets.get(workspaceId);
    if (!target) return false;
    target.paste(text);
    target.focus();
    window.setTimeout(() => targets.get(workspaceId)?.submit(), 120);
    return true;
  },
  /** Subscribe to target changes (for `useSyncExternalStore`). */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** React hook: whether a Claude Code panel is available in `workspaceId`. */
export function useClaudeTarget(workspaceId: string): boolean {
  return useSyncExternalStore(
    claudeBus.subscribe,
    () => targets.has(workspaceId),
    () => false,
  );
}
