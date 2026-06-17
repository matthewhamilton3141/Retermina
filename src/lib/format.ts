/**
 * Collapse a leading home directory into `~` for compact display. Purely
 * cosmetic and best-effort across common macOS / Linux / Windows layouts.
 */
export function prettyPath(path: string): string {
  return path
    .replace(/^\/Users\/[^/]+/, "~")
    .replace(/^\/home\/[^/]+/, "~")
    .replace(/^C:\\Users\\[^\\]+/i, "~");
}

/**
 * The directory portion shown beneath a workspace name (parent of the final
 * path component), home-collapsed for readability.
 */
export function parentDir(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const idx = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (idx <= 0) {
    return prettyPath(normalized);
  }
  return prettyPath(normalized.slice(0, idx));
}
