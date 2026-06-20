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
 * Create a new empty file at `path`. Rejects if the file already exists or
 * the parent directory is inaccessible.
 */
export async function createFile(path: string): Promise<void> {
  return invoke<void>("create_file", { path });
}
