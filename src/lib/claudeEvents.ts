import { Channel, invoke } from "@tauri-apps/api/core";

export type ClaudeSessionEvent =
  | { type: "ready" }
  | { type: "record"; index: number; record: unknown }
  | { type: "error"; message: string };

/**
 * Follow one Claude Code JSONL transcript. The returned id must be passed to
 * `stopClaudeSessionWatch` when the owning panel/session goes away.
 */
export async function watchClaudeSession(
  cwd: string | null,
  sessionId: string,
  onEvent: (event: ClaudeSessionEvent) => void,
): Promise<string> {
  const channel = new Channel<ClaudeSessionEvent>();
  channel.onmessage = onEvent;
  return invoke<string>("watch_claude_session", {
    cwd,
    sessionId,
    onEvent: channel,
  });
}

export function stopClaudeSessionWatch(watcherId: string): Promise<void> {
  return invoke<void>("stop_claude_session_watch", { watcherId });
}
