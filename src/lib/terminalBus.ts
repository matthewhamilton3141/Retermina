/**
 * A tiny pub/sub bridge between the Iris command bar and the live terminal.
 *
 * The terminal panel is deliberately memoized so it never remounts during
 * drag/resize or theme changes (which would tear down its PTY). That isolation
 * means Iris can't reach it through props or context without risking a
 * re-render. Instead, the active `TerminalViewport` registers a small handle
 * here (module state, not React state), and Iris calls into it. Because this
 * lives outside React, writing to the terminal never re-renders the panel.
 *
 * React consumers that only need to know *whether* a terminal is connected use
 * {@link useActiveTerminal}, backed by `useSyncExternalStore`.
 */
import { useSyncExternalStore } from "react";

/** A handle to the currently-focused terminal session. */
export interface ActiveTerminal {
  /** The backend PTY session id this handle drives. */
  sessionId: string;
  /** Run a command line: writes the text followed by a carriage return. */
  run: (command: string) => void;
  /** Write raw data without an implicit newline. */
  write: (data: string) => void;
  /** Focus the terminal so the user sees the command land. */
  focus: () => void;
}

let active: ActiveTerminal | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export const terminalBus = {
  /** Register (or replace) the active terminal handle. */
  set(handle: ActiveTerminal) {
    active = handle;
    emit();
  },
  /**
   * Clear the active handle if it still belongs to `sessionId`. Guarded by id
   * so a torn-down terminal can't wipe a newer one that already registered.
   */
  clear(sessionId: string) {
    if (active?.sessionId === sessionId) {
      active = null;
      emit();
    }
  },
  /** The current handle, or null when no terminal is connected. */
  get(): ActiveTerminal | null {
    return active;
  },
  /**
   * Run a command in the active terminal. Returns false when no terminal is
   * connected, letting Iris fall back to background execution.
   */
  run(command: string): boolean {
    if (!active) return false;
    active.run(command);
    return true;
  },
  /** Subscribe to active-terminal changes (for `useSyncExternalStore`). */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** React hook: the active terminal handle, or null when none is connected. */
export function useActiveTerminal(): ActiveTerminal | null {
  return useSyncExternalStore(
    terminalBus.subscribe,
    () => active,
    () => null,
  );
}
