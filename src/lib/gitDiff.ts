/**
 * Working-tree git diff for the "Changes" panel.
 *
 * Runs `git` via the existing `run_background_command` bridge (no new Rust),
 * so it reflects whatever edits happen in the workspace — including changes an
 * agent like Claude Code makes from the terminal. The panel polls `loadGitDiff`
 * on an interval, so edits appear live.
 *
 * Coverage: tracked modifications/deletions/renames come from `git diff HEAD`;
 * brand-new untracked files are read directly and rendered as all-additions
 * (git wouldn't include them in the diff until staged).
 */

import { runBackgroundCommand } from "./system";
import { readFile } from "./fs";

export type GitDiffLineKind = "hunk" | "add" | "del" | "context";

export interface GitDiffLine {
  kind: GitDiffLineKind;
  text: string;
}

export type GitFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked";

export interface GitDiffFile {
  path: string;
  status: GitFileStatus;
  binary: boolean;
  added: number;
  removed: number;
  lines: GitDiffLine[];
}

export interface GitDiffResult {
  isRepo: boolean;
  files: GitDiffFile[];
}

/** Parse `git diff` unified output into per-file structured diffs. */
export function parseUnifiedDiff(text: string): GitDiffFile[] {
  const files: GitDiffFile[] = [];
  let cur: GitDiffFile | null = null;

  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (cur) files.push(cur);
      cur = { path: "", status: "modified", binary: false, added: 0, removed: 0, lines: [] };
      // Fallback path from the "b/<path>" side; refined by the +++ line below.
      const m = line.match(/ b\/(.+)$/);
      if (m) cur.path = m[1];
      continue;
    }
    if (!cur) continue;

    if (line.startsWith("new file mode")) { cur.status = "added"; continue; }
    if (line.startsWith("deleted file mode")) { cur.status = "deleted"; continue; }
    if (line.startsWith("rename to ")) {
      cur.status = "renamed";
      cur.path = line.slice("rename to ".length).trim();
      continue;
    }
    if (
      line.startsWith("rename from ") ||
      line.startsWith("index ") ||
      line.startsWith("similarity ") ||
      line.startsWith("dissimilarity ") ||
      line.startsWith("old mode") ||
      line.startsWith("new mode") ||
      line.startsWith("--- ")
    ) {
      continue;
    }
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).trim();
      if (p.startsWith("b/")) cur.path = p.slice(2);
      continue;
    }
    if (line.startsWith("Binary files")) { cur.binary = true; continue; }
    if (line.startsWith("@@")) { cur.lines.push({ kind: "hunk", text: line }); continue; }
    if (line === "\\ No newline at end of file") continue;
    if (line.startsWith("+")) { cur.lines.push({ kind: "add", text: line.slice(1) }); cur.added++; continue; }
    if (line.startsWith("-")) { cur.lines.push({ kind: "del", text: line.slice(1) }); cur.removed++; continue; }
    if (line.startsWith(" ")) { cur.lines.push({ kind: "context", text: line.slice(1) }); continue; }
  }
  if (cur) files.push(cur);
  return files;
}

/** Build an all-additions diff for an untracked file by reading its content. */
async function readUntrackedFile(root: string, rel: string): Promise<GitDiffFile> {
  const file: GitDiffFile = {
    path: rel,
    status: "untracked",
    binary: false,
    added: 0,
    removed: 0,
    lines: [],
  };
  try {
    const content = await readFile(`${root}/${rel}`);
    const rows = content.split("\n");
    // A trailing newline yields a final empty element; drop it for display.
    if (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
    file.lines = rows.map((text) => ({ kind: "add" as const, text }));
    file.added = file.lines.length;
  } catch {
    // Binary or too large for the read cap — surface it without contents.
    file.binary = true;
  }
  return file;
}

/**
 * Load the workspace's working-tree changes. Resolves the repo root first so
 * porcelain paths (root-relative) line up with reads, and so we get a clean
 * "not a repo" signal.
 */
export async function loadGitDiff(cwd: string | null): Promise<GitDiffResult> {
  const top = await runBackgroundCommand("git rev-parse --show-toplevel", cwd);
  if (top.code !== 0) return { isRepo: false, files: [] };
  const root = top.stdout.trim();
  if (!root) return { isRepo: false, files: [] };

  // Tracked changes vs the last commit. Fails on a repo with no commits yet;
  // there everything is untracked/staged, so an empty tracked list is fine.
  const diff = await runBackgroundCommand(
    "git -c color.ui=never -c core.quotepath=false --no-pager diff HEAD",
    root,
  );
  const files = diff.code === 0 ? parseUnifiedDiff(diff.stdout) : [];

  // Untracked (new) files — not in `git diff` until staged.
  const status = await runBackgroundCommand(
    "git -c core.quotepath=false --no-pager status --porcelain",
    root,
  );
  if (status.code === 0) {
    const untracked = status.stdout
      .split("\n")
      .filter((l) => l.startsWith("?? "))
      .map((l) => l.slice(3).trim())
      .filter(Boolean);
    for (const rel of untracked) {
      files.push(await readUntrackedFile(root, rel));
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { isRepo: true, files };
}
