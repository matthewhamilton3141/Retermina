//! Local font management for user-uploaded typefaces.
//!
//! Uploaded `.ttf` / `.otf` files are copied into a per-user app-data folder
//! (`<data_dir>/Retermina/fonts`) so they survive restarts. The frontend sends
//! the picked file's bytes as base64 (read in the webview via a file input),
//! and re-reads them on startup to register each face with the FontFace Web
//! API. Keeping the bytes flowing through Rust means we never depend on the
//! asset:// protocol or its scope configuration.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::path::PathBuf;

/// Absolute path to the fonts directory, creating it if necessary.
fn fonts_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or("Could not resolve the user data directory")?;
    let dir = base.join("Retermina").join("fonts");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create fonts directory: {e}"))?;
    Ok(dir)
}

/// Reduce an arbitrary string to a safe file name (no path separators / traversal).
fn safe_file_name(name: &str) -> Result<String, String> {
    let stem = std::path::Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("Invalid font file name")?;
    if stem.is_empty() || stem.starts_with('.') {
        return Err("Invalid font file name".into());
    }
    Ok(stem.to_string())
}

/// Persist a font uploaded from the webview. `data` is the base64-encoded file
/// content; `file_name` is the original name (used only for its final segment).
/// Returns the stored file name (which may be suffixed to avoid collisions).
#[tauri::command]
pub fn save_font(file_name: String, data: String) -> Result<String, String> {
    let name = safe_file_name(&file_name)?;
    let ext = std::path::Path::new(&name)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    if ext != "ttf" && ext != "otf" {
        return Err("Only .ttf and .otf font files are supported".into());
    }

    let bytes = STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("Could not decode font data: {e}"))?;

    let dir = fonts_dir()?;

    // Avoid clobbering an existing file with the same name.
    let mut target = dir.join(&name);
    if target.exists() {
        let stem = std::path::Path::new(&name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("font")
            .to_string();
        let mut i = 1;
        loop {
            let candidate = dir.join(format!("{stem}-{i}.{ext}"));
            if !candidate.exists() {
                target = candidate;
                break;
            }
            i += 1;
        }
    }

    std::fs::write(&target, &bytes).map_err(|e| format!("Could not save font: {e}"))?;
    target
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Could not resolve stored font name".into())
}

/// Read a stored font back as base64 so the frontend can register it.
#[tauri::command]
pub fn read_font(file_name: String) -> Result<String, String> {
    let name = safe_file_name(&file_name)?;
    let path = fonts_dir()?.join(&name);
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read font: {e}"))?;
    Ok(STANDARD.encode(bytes))
}

/// List the file names of every stored font.
#[tauri::command]
pub fn list_fonts() -> Result<Vec<String>, String> {
    let dir = fonts_dir()?;
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .map_err(|e| format!("Could not read fonts directory: {e}"))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.file_name().to_str().map(|s| s.to_string()))
        .filter(|name| {
            let lower = name.to_ascii_lowercase();
            lower.ends_with(".ttf") || lower.ends_with(".otf")
        })
        .collect();
    names.sort();
    Ok(names)
}

/// Delete a stored font file. A missing file is treated as success.
#[tauri::command]
pub fn delete_font(file_name: String) -> Result<(), String> {
    let name = safe_file_name(&file_name)?;
    let path = fonts_dir()?.join(&name);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Could not delete font: {e}"))?;
    }
    Ok(())
}
