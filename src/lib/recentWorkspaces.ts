import { invoke } from "@tauri-apps/api/core";

/** Mirrors the Rust `RecentWorkspace` from `vscode.rs`. */
export interface RecentWorkspace {
  /** Absolute local filesystem path. */
  path: string;
  /** Display name (final path component). */
  name: string;
  /** One of "folder", "file", or "workspace". */
  kind: "folder" | "file" | "workspace";
  /** Whether the path still exists on disk. */
  exists: boolean;
}

/**
 * Recently-opened entries read from the local VSCode/Cursor/VSCodium history
 * database. Resolves to `[]` when no editor is installed or the history can't
 * be read, so callers never need their own fallback.
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
