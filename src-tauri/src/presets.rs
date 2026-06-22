//! Persistence for Retermina Loom presets.
//!
//! The full preset library is stored as a single JSON document at
//! `<data_dir>/Retermina/presets.json`. The frontend's Zustand store uses these
//! two commands as its storage backend (read on hydrate, write on change), so
//! presets survive app restarts without depending on localStorage. Export /
//! import of individual `.json` files goes through the generic `fs` commands and
//! the dialog plugin instead.

use std::path::PathBuf;

/// Absolute path to `presets.json`, creating the parent directory if needed.
fn presets_path() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or("Could not resolve the user data directory")?;
    let dir = base.join("Retermina");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create data directory: {e}"))?;
    Ok(dir.join("presets.json"))
}

/// Read the raw presets document. Returns an empty string when the file does
/// not exist yet so the store hydrates to an empty library rather than erroring.
#[tauri::command]
pub fn read_presets() -> Result<String, String> {
    let path = presets_path()?;
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("Could not read presets: {e}"))
}

/// Overwrite the presets document with `data` (the serialized store state).
#[tauri::command]
pub fn write_presets(data: String) -> Result<(), String> {
    let path = presets_path()?;
    std::fs::write(&path, data).map_err(|e| format!("Could not write presets: {e}"))
}
