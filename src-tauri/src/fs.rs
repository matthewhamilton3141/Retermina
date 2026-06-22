//! File-system commands for the Explorer and Code View panels.
//!
//! `list_dir` returns the immediate children of a directory (sorted, hidden
//! files excluded). `read_file` reads a UTF-8 text file — binary files or
//! files over the size cap return an error, which the frontend surfaces inline.

use serde::Serialize;

/// A single directory entry returned by [`list_dir`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// Maximum file size (bytes) [`read_file`] will read into memory.
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024; // 5 MB

/// List the immediate children of `path`.
///
/// Hidden entries (names starting with `.`) are excluded. The result is sorted
/// with directories first, then files, both groups case-insensitively
/// alphabetical.
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries: Vec<DirEntry> = std::fs::read_dir(&path)
        .map_err(|e| format!("Cannot read directory: {e}"))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .map(|name| !name.starts_with('.'))
                .unwrap_or(false)
        })
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            let path = entry.path().to_str()?.to_string();
            let is_dir = entry.file_type().ok()?.is_dir();
            Some(DirEntry { name, path, is_dir })
        })
        .collect();

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

/// Directory names skipped entirely by [`list_files`] (build artifacts, VCS,
/// dependency trees) so the quick-open index stays fast and relevant.
const IGNORED_DIRS: &[&str] = &[
    "node_modules", ".git", "dist", "build", "target", ".next", ".cache",
    ".svelte-kit", "out", ".turbo", ".venv", "venv", "__pycache__",
];

/// Recursively list file paths under `root` for the quick-open file search.
///
/// Returns paths relative to `root`, capped at `max` entries (a depth-first
/// walk that bails as soon as the cap is hit so huge trees never hang). Hidden
/// entries and well-known build/VCS/dependency directories are skipped.
#[tauri::command]
pub fn list_files(root: String, max: usize) -> Result<Vec<String>, String> {
    let root_path = std::path::Path::new(&root);
    if !root_path.is_dir() {
        return Err("Not a directory".into());
    }

    let mut out: Vec<String> = Vec::new();
    let mut stack: Vec<std::path::PathBuf> = vec![root_path.to_path_buf()];

    while let Some(dir) = stack.pop() {
        if out.len() >= max {
            break;
        }
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue, // Unreadable dir — skip, don't fail the whole walk.
        };
        for entry in entries.filter_map(|e| e.ok()) {
            let name = match entry.file_name().into_string() {
                Ok(n) => n,
                Err(_) => continue,
            };
            if name.starts_with('.') {
                continue;
            }
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir {
                if !IGNORED_DIRS.contains(&name.as_str()) {
                    stack.push(entry.path());
                }
            } else if out.len() < max {
                if let Ok(rel) = entry.path().strip_prefix(root_path) {
                    if let Some(s) = rel.to_str() {
                        out.push(s.to_string());
                    }
                }
            }
        }
    }

    out.sort();
    Ok(out)
}

/// Rename (or move) a filesystem entry from `from` to `to`.
#[tauri::command]
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    std::fs::rename(&from, &to).map_err(|e| format!("Cannot rename: {e}"))
}

/// Delete a file or directory. Directories are removed recursively.
#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("Cannot stat: {e}"))?;
    if meta.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| format!("Cannot delete directory: {e}"))
    } else {
        std::fs::remove_file(&path).map_err(|e| format!("Cannot delete file: {e}"))
    }
}

/// Create a directory at `path`, including all parent directories.
#[tauri::command]
pub fn create_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("Cannot create directory: {e}"))
}

/// Create a new empty file at `path`. Fails if the file already exists or the
/// parent directory is not accessible.
#[tauri::command]
pub fn create_file(path: String) -> Result<(), String> {
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map(|_| ())
        .map_err(|e| format!("Cannot create file: {e}"))
}

/// Write `content` to `path`, replacing the file completely.
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("Cannot write file: {e}"))
}

/// Return subdirectories of the parent component of `partial_path` whose
/// names start with the typed fragment. Hidden directories are excluded.
/// Results are sorted and capped at 15 entries.
#[tauri::command]
pub fn suggest_directories(partial_path: String) -> Vec<String> {
    if partial_path.is_empty() {
        return Vec::new();
    }

    let input = std::path::Path::new(&partial_path);
    let sep = std::path::MAIN_SEPARATOR;

    // If the path ends with a separator the user wants children of that dir.
    let trailing_sep = partial_path.ends_with(sep) || partial_path.ends_with('/');

    let (parent, prefix): (&std::path::Path, &str) = if trailing_sep {
        (input, "")
    } else {
        let p = input.parent().unwrap_or_else(|| std::path::Path::new("/"));
        let stem = input.file_name().and_then(|n| n.to_str()).unwrap_or("");
        (p, stem)
    };

    let Ok(read_dir) = std::fs::read_dir(parent) else {
        return Vec::new();
    };

    let prefix_lower = prefix.to_lowercase();

    let mut results: Vec<String> = read_dir
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().ok().map(|t| t.is_dir()).unwrap_or(false))
        .filter(|e| {
            let raw = e.file_name();
            let name = raw.to_string_lossy();
            !name.starts_with('.') && name.to_lowercase().starts_with(&prefix_lower)
        })
        .filter_map(|e| e.path().to_str().map(|s| s.to_string()))
        .take(15)
        .collect();

    results.sort();
    results
}

/// Return `true` if `path` exists on the filesystem and is a directory.
#[tauri::command]
pub fn validate_directory(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}

/// Read a UTF-8 text file. Returns an error for binary files, missing files,
/// or files exceeding the 5 MB cap.
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let metadata =
        std::fs::metadata(&path).map_err(|e| format!("Cannot stat file: {e}"))?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(format!(
            "File is too large to display ({} MB — limit is 5 MB).",
            metadata.len() / 1024 / 1024
        ));
    }
    std::fs::read_to_string(&path).map_err(|e| format!("Cannot read file: {e}"))
}
