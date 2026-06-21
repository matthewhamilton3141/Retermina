import { invoke } from "@tauri-apps/api/core";

export interface TerminalImport {
  /** Absolute cwd of the detected terminal session. */
  cwd: string;
  /** Display name of the app the cwd was read from (e.g. "Terminal.app"). */
  app: string;
}

/**
 * Ask the Rust backend to detect the cwd of the most recently active terminal
 * emulator (Terminal.app → iTerm2 → Warp → generic shell fallback).
 * Rejects with a human-readable error string if nothing is found.
 */
export async function getTerminalCwd(): Promise<TerminalImport> {
  return invoke<TerminalImport>("get_terminal_cwd");
}
