import { Channel, invoke } from "@tauri-apps/api/core";

import type { ClaudeModelChoice } from "../store/claudeSessions";
import type { ClaudePermissionMode } from "./claudeTranscript";

/**
 * Events streamed from a managed Claude stream-json subprocess (see
 * `src-tauri/src/claude_agent.rs`). `record` events are raw stream-json objects,
 * shaped like the JSONL transcript records the transcript parser already folds.
 */
export type ClaudeAgentEvent =
  | { type: "record"; record: unknown }
  | { type: "notice"; message: string }
  | { type: "exit"; code: number | null };

export interface StartClaudeAgentOptions {
  cwd: string | null;
  sessionId: string;
  permissionMode: ClaudePermissionMode;
  model: ClaudeModelChoice;
  /** `--resume` an existing session instead of starting a new `--session-id`. */
  resume: boolean;
  onEvent: (event: ClaudeAgentEvent) => void;
}

/** Start a stream-json Claude session; resolves to the handle id used below. */
export async function startClaudeAgent(
  options: StartClaudeAgentOptions,
): Promise<string> {
  const channel = new Channel<ClaudeAgentEvent>();
  channel.onmessage = options.onEvent;
  return invoke<string>("start_claude_agent", {
    cwd: options.cwd,
    sessionId: options.sessionId,
    permissionMode: options.permissionMode,
    model: options.model === "default" ? null : options.model,
    resume: options.resume,
    onEvent: channel,
  });
}

/** Send one user turn to a running agent. */
export function sendClaudeAgentMessage(handleId: string, text: string): Promise<void> {
  return invoke<void>("send_claude_agent", { handleId, text });
}

/** Cancel the in-flight turn (stream-json interrupt control request). */
export function interruptClaudeAgent(handleId: string): Promise<void> {
  return invoke<void>("interrupt_claude_agent", { handleId });
}

/** Kill an agent subprocess and forget it. */
export function stopClaudeAgent(handleId: string): Promise<void> {
  return invoke<void>("stop_claude_agent", { handleId });
}
