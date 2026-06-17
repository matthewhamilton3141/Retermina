/** Mirrors the Rust `RecentWorkspace` returned by `get_recent_workspaces`. */
export type RecentKind = "folder" | "file" | "workspace";

export interface RecentWorkspace {
  /** Absolute local filesystem path. */
  path: string;
  /** Display name (final path component). */
  name: string;
  kind: RecentKind;
  /** Whether the path still exists on disk. */
  exists: boolean;
}
