import { invoke } from "@tauri-apps/api/core";

/** Mirrors the Rust `DirEntry` from `fs.rs`. */
export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

/**
 * List the immediate children of `path`. Hidden entries are excluded and the
 * result is sorted dirs-first, both groups alphabetical.
 */
export async function listDir(path: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("list_dir", { path });
}

/**
 * Read a UTF-8 text file. Rejects for binary files, missing paths, or files
 * over the 5 MB backend cap.
 */
export async function readFile(path: string): Promise<string> {
  return invoke<string>("read_file", { path });
}

/**
 * Overwrite `path` with `content`. Creates the file if it doesn't exist.
 */
export async function writeFile(path: string, content: string): Promise<void> {
  return invoke<void>("write_file", { path, content });
}

/** Rename or move a filesystem entry. */
export async function renamePath(from: string, to: string): Promise<void> {
  return invoke<void>("rename_path", { from, to });
}

/** Delete a file or directory (directories removed recursively). */
export async function deletePath(path: string): Promise<void> {
  return invoke<void>("delete_path", { path });
}

/** Create a directory, including parent directories. */
export async function createDir(path: string): Promise<void> {
  return invoke<void>("create_dir", { path });
}

/**
 * Create a new empty file at `path`. Rejects if the file already exists or
 * the parent directory is inaccessible.
 */
export async function createFile(path: string): Promise<void> {
  return invoke<void>("create_file", { path });
}

/**
 * Return subdirectories matching `partialPath`. Hidden directories are
 * excluded. Results are sorted and capped at 15 entries.
 */
export async function suggestDirectories(partialPath: string): Promise<string[]> {
  return invoke<string[]>("suggest_directories", { partialPath });
}

/**
 * Return true if `path` exists on the filesystem and is a directory.
 */
export async function validateDirectory(path: string): Promise<boolean> {
  return invoke<boolean>("validate_directory", { path });
}

/**
 * Recursively list file paths under `root` (relative to it) for quick-open,
 * capped at `max`. Hidden entries and build/VCS/dependency dirs are skipped.
 */
export async function listFiles(root: string, max = 4000): Promise<string[]> {
  return invoke<string[]>("list_files", { root, max });
}

/** A single matching line within a file. Mirrors the Rust `SearchMatch`. */
export interface SearchMatch {
  /** 1-based line number. */
  line: number;
  /** The matched line's text (short lines whole; long lines windowed around the hit). */
  text: string;
}

/** All matches found in one file. Mirrors the Rust `FileMatches`. */
export interface FileMatches {
  /** Path relative to the search root. */
  path: string;
  matches: SearchMatch[];
}

/**
 * Search file *contents* under `root` for a plain-substring `query`. Skips
 * hidden/build/VCS dirs, binary files, and files over 2 MB; stops once
 * `maxResults` total matching lines are found. Resolves to `[]` on failure so
 * the panel degrades to an empty state.
 */
export async function searchInFiles(
  root: string,
  query: string,
  caseSensitive = false,
  maxResults = 500,
): Promise<FileMatches[]> {
  try {
    return await invoke<FileMatches[]>("search_in_files", {
      root,
      query,
      caseSensitive,
      maxResults,
    });
  } catch (error) {
    console.error("[retermina] search_in_files failed:", error);
    return [];
  }
}

/** Read the raw Retermina Loom presets document (empty string if none yet). */
export async function readPresets(): Promise<string> {
  return invoke<string>("read_presets");
}

/** Overwrite the presets document with the serialized store state. */
export async function writePresets(data: string): Promise<void> {
  return invoke<void>("write_presets", { data });
}

export interface ClaudeTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  sessionCount: number;
  /** Approximate cost in USD (Claude Sonnet 4 pricing). */
  estimatedCostUsd: number;
}

/**
 * Return cumulative token usage for all Claude Code sessions in `cwd`.
 * Returns zeroed totals when no history exists for the project.
 */
export async function getClaudeTokenUsage(cwd: string): Promise<ClaudeTokenUsage> {
  return invoke<ClaudeTokenUsage>("get_claude_token_usage", { cwd });
}

/**
 * Sync Claude Code's persisted UI theme (in `~/.claude.json`) so the embedded
 * Claude Code panel matches Retermina's active engine. Takes effect on the next
 * `claude` launch. Best-effort: rejects only on a bad theme id, otherwise no-ops
 * when the config is missing/unreadable.
 */
export async function setClaudeTheme(theme: string): Promise<void> {
  return invoke<void>("set_claude_theme", { theme });
}
