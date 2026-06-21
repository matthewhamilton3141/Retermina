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
