//! Reads the local VSCode (or compatible fork) SQLite history database to
//! surface recently opened folders/files/workspaces on the Launch Hub.
//!
//! VSCode persists `history.recentlyOpenedPathsList` in the key/value
//! `ItemTable` of `state.vscdb`. We open that database **read-only** and
//! **immutable** so we never lock or mutate it, even while the editor is
//! running in WAL mode.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;

/// A single recently-opened entry surfaced on the Launch Hub.
#[derive(Debug, Clone, Serialize)]
pub struct RecentWorkspace {
    /// Absolute local filesystem path (decoded from the VSCode `file://` URI).
    pub path: String,
    /// Display name (final path component).
    pub name: String,
    /// One of `"folder"`, `"file"`, or `"workspace"`.
    pub kind: String,
    /// Whether the path still exists on disk.
    pub exists: bool,
}

/// Editor application directories to probe, in preference order. All VSCode
/// forks share the same `state.vscdb` schema, so Cursor/VSCodium "just work".
const APP_DIRS: [&str; 4] = ["Code", "Code - Insiders", "VSCodium", "Cursor"];

/// Locate the most-recently-modified `state.vscdb` among known editors.
///
/// VSCode stores it under the platform config dir:
/// - macOS:   `~/Library/Application Support/<app>/User/globalStorage/state.vscdb`
/// - Windows: `%APPDATA%\<app>\User\globalStorage\state.vscdb`
/// - Linux:   `~/.config/<app>/User/globalStorage/state.vscdb`
fn locate_state_db() -> Option<PathBuf> {
    let base = dirs::config_dir()?;
    let mut best: Option<(PathBuf, std::time::SystemTime)> = None;

    for app in APP_DIRS {
        let candidate = base
            .join(app)
            .join("User")
            .join("globalStorage")
            .join("state.vscdb");

        if let Ok(meta) = std::fs::metadata(&candidate) {
            let modified = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
            let is_better = best.as_ref().map(|(_, t)| modified > *t).unwrap_or(true);
            if is_better {
                best = Some((candidate, modified));
            }
        }
    }

    best.map(|(path, _)| path)
}

/// Build a SQLite `file:` URI (read-only + immutable) from a filesystem path,
/// percent-encoding bytes that are unsafe in a URI while preserving path
/// separators. `immutable=1` lets us read a live WAL database without touching
/// its `-wal`/`-shm` sidecars.
fn to_sqlite_uri(path: &Path) -> String {
    let raw = path.to_string_lossy();
    let normalized = raw.replace('\\', "/"); // Windows backslashes -> slashes

    let mut uri = String::with_capacity(normalized.len() + 24);
    uri.push_str("file:");
    // Windows drive paths ("C:/Users/...") need a leading slash: "file:/C:/...".
    if cfg!(windows) && !normalized.starts_with('/') {
        uri.push('/');
    }

    for byte in normalized.bytes() {
        match byte {
            b'/' | b':' | b'-' | b'_' | b'.' | b'~' | b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' => {
                uri.push(byte as char);
            }
            other => uri.push_str(&format!("%{other:02X}")),
        }
    }

    uri.push_str("?mode=ro&immutable=1");
    uri
}

/// Decode a `file://` URI into a local filesystem path. Returns `None` for
/// non-file URIs (e.g. remote `vscode-remote://` entries).
fn file_uri_to_path(uri: &str) -> Option<String> {
    // For local files the authority is empty, so `file:///Users/x` -> `/Users/x`.
    let rest = uri.strip_prefix("file://")?;
    let decoded = urlencoding::decode(rest).ok()?.into_owned();

    if cfg!(windows) {
        // "/C:/Users/..." -> "C:\\Users\\..."
        let bytes = decoded.as_bytes();
        let trimmed = if bytes.len() >= 3 && bytes[0] == b'/' && bytes[2] == b':' {
            &decoded[1..]
        } else {
            &decoded[..]
        };
        return Some(trimmed.replace('/', "\\"));
    }

    Some(decoded)
}

/// Final path component for display, falling back to the full path.
fn display_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| path.to_string())
}

/// Parse the JSON stored under `history.recentlyOpenedPathsList`.
///
/// Shape (abbreviated):
/// ```json
/// { "entries": [
///     { "folderUri": "file:///Users/x/proj" },
///     { "fileUri": "file:///Users/x/notes.txt" },
///     { "workspace": { "configPath": "file:///Users/x/team.code-workspace" } }
/// ] }
/// ```
fn parse_entries(value: &str, limit: usize) -> Vec<RecentWorkspace> {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(value) else {
        return Vec::new();
    };
    let Some(entries) = json.get("entries").and_then(|e| e.as_array()) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for entry in entries {
        let (uri, kind) = if let Some(u) = entry.get("folderUri").and_then(|v| v.as_str()) {
            (u, "folder")
        } else if let Some(u) = entry.get("fileUri").and_then(|v| v.as_str()) {
            (u, "file")
        } else if let Some(u) = entry
            .get("workspace")
            .and_then(|w| w.get("configPath"))
            .and_then(|v| v.as_str())
        {
            (u, "workspace")
        } else {
            continue;
        };

        // Only surface local entries; skip remote (ssh / dev-container) URIs.
        if !uri.starts_with("file://") {
            continue;
        }

        if let Some(path) = file_uri_to_path(uri) {
            let exists = Path::new(&path).exists();
            out.push(RecentWorkspace {
                name: display_name(&path),
                path,
                kind: kind.to_string(),
                exists,
            });
        }

        if out.len() >= limit {
            break;
        }
    }

    out
}

/// Read up to `limit` recent workspaces from the editor history database.
///
/// Returns an empty list (not an error) when no editor is installed or the key
/// is absent, so the Launch Hub degrades gracefully.
pub fn read_recent_workspaces(limit: usize) -> Result<Vec<RecentWorkspace>, String> {
    let Some(db_path) = locate_state_db() else {
        return Ok(Vec::new());
    };

    let conn = Connection::open_with_flags(
        to_sqlite_uri(&db_path),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| format!("failed to open {}: {e}", db_path.display()))?;

    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM ItemTable WHERE key = ?1",
            ["history.recentlyOpenedPathsList"],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("failed to query ItemTable: {e}"))?;

    Ok(value.map(|v| parse_entries(&v, limit)).unwrap_or_default())
}

/// Tauri command: most-recent workspaces for the Launch Hub.
#[tauri::command]
pub fn get_recent_workspaces(limit: Option<usize>) -> Result<Vec<RecentWorkspace>, String> {
    let limit = limit.unwrap_or(10).clamp(1, 50);
    read_recent_workspaces(limit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_basic_file_uri() {
        assert_eq!(
            file_uri_to_path("file:///Users/matthew/project").as_deref(),
            Some("/Users/matthew/project")
        );
    }

    #[test]
    fn decodes_percent_encoded_characters() {
        assert_eq!(
            file_uri_to_path("file:///Users/matthew/My%20Project").as_deref(),
            Some("/Users/matthew/My Project")
        );
    }

    #[test]
    fn rejects_non_file_uri() {
        assert_eq!(file_uri_to_path("vscode-remote://ssh/root/app"), None);
    }

    #[test]
    fn parses_folder_file_and_workspace_entries() {
        let json = r#"{
            "entries": [
                { "folderUri": "file:///Users/matthew/alpha" },
                { "fileUri": "file:///Users/matthew/notes.txt" },
                { "workspace": { "id": "x", "configPath": "file:///Users/matthew/team.code-workspace" } },
                { "folderUri": "vscode-remote://ssh-remote%2Bhost/root/app" }
            ]
        }"#;

        let items = parse_entries(json, 10);
        assert_eq!(items.len(), 3, "remote entry should be skipped");
        assert_eq!(items[0].kind, "folder");
        assert_eq!(items[0].name, "alpha");
        assert_eq!(items[1].kind, "file");
        assert_eq!(items[1].name, "notes.txt");
        assert_eq!(items[2].kind, "workspace");
        assert_eq!(items[2].name, "team.code-workspace");
    }

    #[test]
    fn respects_limit() {
        let json = r#"{"entries":[
            {"folderUri":"file:///a"},
            {"folderUri":"file:///b"},
            {"folderUri":"file:///c"}
        ]}"#;
        assert_eq!(parse_entries(json, 2).len(), 2);
    }

    #[test]
    fn returns_empty_on_garbage_or_missing_entries() {
        assert!(parse_entries("not json at all", 10).is_empty());
        assert!(parse_entries("{}", 10).is_empty());
        assert!(parse_entries(r#"{"entries":[]}"#, 10).is_empty());
    }

    /// Exercises the full SQLite path against whatever editor history exists on
    /// this machine. Always `Ok` (empty when no editor is installed).
    #[test]
    fn smoke_read_real_db() {
        let result = read_recent_workspaces(10);
        match &result {
            Ok(items) => {
                println!("read_recent_workspaces -> {} item(s)", items.len());
                for it in items {
                    println!("  [{}] {} -> {} (exists={})", it.kind, it.name, it.path, it.exists);
                }
            }
            Err(e) => println!("read_recent_workspaces error: {e}"),
        }
        assert!(result.is_ok());
    }
}
