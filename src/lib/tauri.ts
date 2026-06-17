import { invoke } from "@tauri-apps/api/core";

import type { RecentWorkspace } from "../types";

/**
 * Typed wrappers around Tauri commands. Centralizing the `invoke` boundary
 * keeps components free of stringly-typed command names and shapes.
 */

/**
 * Fetch the user's most-recent VSCode (or compatible editor) workspaces from
 * the local `state.vscdb`. Resolves to `[]` when the editor isn't installed or
 * the history can't be read, so callers never need their own try/catch.
 */
export async function getRecentWorkspaces(
  limit = 10,
): Promise<RecentWorkspace[]> {
  try {
    return await invoke<RecentWorkspace[]>("get_recent_workspaces", { limit });
  } catch (error) {
    console.error("[retermina] get_recent_workspaces failed:", error);
    return [];
  }
}
