import { invoke } from "@tauri-apps/api/core";

/**
 * Typed wrappers around the system commands (localhost tracker + shell-backed
 * git status / background command). Centralizing the `invoke` boundary keeps
 * components free of stringly-typed command names and mirrors the Rust payloads.
 */

/* -------------------------------------------------------------------------- */
/* Localhost tracker                                                          */
/* -------------------------------------------------------------------------- */

/** Mirrors the Rust `ListeningPort` from `localhost.rs`. */
export interface ListeningPort {
  port: number;
  pid: number;
  /** Process/command name (best-effort; may be empty on Windows). */
  process: string;
  /** Local bind address as reported by the OS (e.g. `127.0.0.1:3000`). */
  address: string;
  protocol: string;
}

/**
 * List processes listening on local TCP ports. Resolves to `[]` when discovery
 * fails (e.g. the platform tool is missing), so the tracker degrades to an
 * empty state instead of erroring.
 */
export async function listListeningPorts(): Promise<ListeningPort[]> {
  try {
    return await invoke<ListeningPort[]>("list_listening_ports");
  } catch (error) {
    console.error("[retermina] list_listening_ports failed:", error);
    return [];
  }
}

/**
 * Terminate a process by pid. Errors propagate so the caller can surface why a
 * kill failed (e.g. insufficient permissions). `force` escalates to
 * SIGKILL / `taskkill /F`.
 */
export function killProcess(pid: number, force = false): Promise<void> {
  return invoke<void>("kill_process", { pid, force });
}

/* -------------------------------------------------------------------------- */
/* Shell-backed commands                                                      */
/* -------------------------------------------------------------------------- */

/** Mirrors the Rust `CommandResult` from `shell.rs`. */
export interface CommandResult {
  /** Exit code, or null if the process was terminated by a signal. */
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run a one-shot command in the background and capture its output — used where a
 * captured result is needed without a live terminal (Changes panel, repo clone).
 */
export function runBackgroundCommand(
  command: string,
  cwd?: string | null,
): Promise<CommandResult> {
  return invoke<CommandResult>("run_background_command", { command, cwd });
}

/** Mirrors the Rust `GitStatus` from `shell.rs`. */
export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  commit: string | null;
  hasUpstream: boolean;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicts: number;
  clean: boolean;
}

/** The "not a repository" baseline, also used as the fetch-failure fallback. */
export const DEFAULT_GIT_STATUS: GitStatus = {
  isRepo: false,
  branch: null,
  commit: null,
  hasUpstream: false,
  ahead: 0,
  behind: 0,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  conflicts: 0,
  clean: false,
};

/**
 * Inspect the Git repository rooted at `cwd` (branch, ahead/behind, dirty state)
 * for the workspace header git badge. Resolves to {@link DEFAULT_GIT_STATUS} on
 * failure so callers never throw.
 */
export async function gitStatus(cwd?: string | null): Promise<GitStatus> {
  try {
    return await invoke<GitStatus>("git_status", { cwd });
  } catch (error) {
    console.error("[retermina] git_status failed:", error);
    return DEFAULT_GIT_STATUS;
  }
}
