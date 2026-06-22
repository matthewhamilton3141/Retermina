import { Channel, invoke } from "@tauri-apps/api/core";

/** Messages streamed from a PTY session (mirrors the Rust `PtyEvent`). */
export type PtyEvent =
  | { type: "data"; chunk: string } // base64-encoded raw bytes
  | { type: "exit"; code: number | null };

export interface CreatePtyOptions {
  /** Working directory; file paths resolve to their parent on the backend. */
  cwd?: string | null;
  cols: number;
  rows: number;
  /**
   * `COLORFGBG` value ("fg;bg") derived from the active theme so CLI tools pick
   * colours legible on the current background. See `terminalColorFgbg`.
   */
  colorFgbg?: string;
}

/**
 * Open a PTY session. `onEvent` receives streamed output/exit messages over a
 * Tauri channel. Resolves to the session id used by the other helpers.
 */
export async function createPtySession(
  options: CreatePtyOptions,
  onEvent: (event: PtyEvent) => void,
): Promise<string> {
  const channel = new Channel<PtyEvent>();
  channel.onmessage = onEvent;
  return invoke<string>("create_pty_session", { options, onEvent: channel });
}

/** Send user input (keystrokes / paste) to the shell. */
export function writeToPty(sessionId: string, data: string): Promise<void> {
  return invoke<void>("write_to_pty", { sessionId, data });
}

/** Resize the PTY to match the on-screen terminal geometry. */
export function resizePty(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke<void>("resize_pty", { sessionId, cols, rows });
}

/** Terminate the shell and release the session. */
export function closePty(sessionId: string): Promise<void> {
  return invoke<void>("close_pty", { sessionId });
}
