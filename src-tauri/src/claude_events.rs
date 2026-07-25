//! Live reader for the JSONL transcript owned by a Claude Code session.
//!
//! Retermina still runs the real interactive Claude CLI in a PTY. This module
//! observes the exact session file created by that process and forwards each
//! complete JSON record to the webview, where it can be rendered as a clean
//! agent transcript without trying to reverse-engineer xterm's screen buffer.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;

#[derive(Default)]
pub struct ClaudeEventManager {
    watchers: Mutex<HashMap<String, Arc<AtomicBool>>>,
    next_id: AtomicU64,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClaudeSessionEvent {
    Ready,
    Record { index: u64, record: Value },
    Error { message: String },
}

fn effective_cwd(cwd: Option<String>) -> Option<PathBuf> {
    let requested = cwd.filter(|value| !value.trim().is_empty());
    let path = requested.map(PathBuf::from).or_else(dirs::home_dir)?;
    if path.is_file() {
        path.parent().map(PathBuf::from)
    } else {
        Some(path)
    }
}

fn transcript_path(cwd: Option<String>, session_id: &str) -> Option<PathBuf> {
    let cwd = effective_cwd(cwd)?;
    let project_key = cwd.to_string_lossy().replace(['/', '\\'], "-");
    Some(
        dirs::home_dir()?
            .join(".claude")
            .join("projects")
            .join(project_key)
            .join(format!("{session_id}.jsonl")),
    )
}

/// Find a session by UUID when Claude canonicalized or changed the requested
/// working directory before choosing its project-history folder. Session UUIDs
/// are globally unique, so the filename is a safer fallback than guessing a
/// second path encoding.
fn discover_transcript(projects_dir: &std::path::Path, session_id: &str) -> Option<PathBuf> {
    let filename = format!("{session_id}.jsonl");
    let entries = std::fs::read_dir(projects_dir).ok()?;
    for entry in entries.filter_map(Result::ok) {
        let project_dir = entry.path();
        if !project_dir.is_dir() {
            continue;
        }
        let candidate = project_dir.join(&filename);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn valid_session_id(session_id: &str) -> bool {
    !session_id.is_empty()
        && session_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
}

#[tauri::command]
pub fn watch_claude_session(
    manager: tauri::State<'_, ClaudeEventManager>,
    cwd: Option<String>,
    session_id: String,
    on_event: Channel<ClaudeSessionEvent>,
) -> Result<String, String> {
    if !valid_session_id(&session_id) {
        return Err("invalid Claude session id".into());
    }
    let preferred_path = transcript_path(cwd, &session_id)
        .ok_or_else(|| "could not resolve Claude transcript directory".to_string())?;
    let projects_dir = dirs::home_dir()
        .map(|home| home.join(".claude").join("projects"))
        .ok_or_else(|| "could not resolve Claude projects directory".to_string())?;

    let id = manager.next_id.fetch_add(1, Ordering::Relaxed);
    let watcher_id = format!("claude-watch-{id}");
    let stopped = Arc::new(AtomicBool::new(false));
    manager
        .watchers
        .lock()
        .map_err(|_| "Claude watcher lock poisoned".to_string())?
        .insert(watcher_id.clone(), Arc::clone(&stopped));

    std::thread::spawn(move || {
        // The CLI creates its transcript shortly after the PTY command starts.
        // Wait without a deadline: closing the panel flips `stopped`. Prefer
        // the expected cwd-derived path, then fall back to UUID discovery in
        // case Claude resolved the cwd through a symlink or changed directory.
        let path = loop {
            if stopped.load(Ordering::Relaxed) {
                return;
            }
            if preferred_path.is_file() {
                break preferred_path.clone();
            }
            if let Some(discovered) = discover_transcript(&projects_dir, &session_id) {
                break discovered;
            }
            std::thread::sleep(Duration::from_millis(180));
        };

        let file = match File::open(&path) {
            Ok(file) => file,
            Err(error) => {
                let _ = on_event.send(ClaudeSessionEvent::Error {
                    message: format!("Could not open Claude transcript: {error}"),
                });
                return;
            }
        };
        let mut reader = BufReader::new(file);
        let mut index = 0_u64;

        if on_event.send(ClaudeSessionEvent::Ready).is_err() {
            return;
        }

        while !stopped.load(Ordering::Relaxed) {
            let line_start = match reader.stream_position() {
                Ok(position) => position,
                Err(_) => break,
            };
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    std::thread::sleep(Duration::from_millis(120));
                }
                Ok(_) if !line.ends_with('\n') => {
                    // Never consume a record while Claude is still appending it.
                    let _ = reader.seek(SeekFrom::Start(line_start));
                    std::thread::sleep(Duration::from_millis(60));
                }
                Ok(_) => {
                    let Ok(record) = serde_json::from_str::<Value>(line.trim_end()) else {
                        continue;
                    };
                    if on_event
                        .send(ClaudeSessionEvent::Record { index, record })
                        .is_err()
                    {
                        break;
                    }
                    index += 1;
                }
                Err(error) => {
                    let _ = on_event.send(ClaudeSessionEvent::Error {
                        message: format!("Could not read Claude transcript: {error}"),
                    });
                    break;
                }
            }
        }
    });

    Ok(watcher_id)
}

#[tauri::command]
pub fn stop_claude_session_watch(
    manager: tauri::State<'_, ClaudeEventManager>,
    watcher_id: String,
) -> Result<(), String> {
    if let Some(stopped) = manager
        .watchers
        .lock()
        .map_err(|_| "Claude watcher lock poisoned".to_string())?
        .remove(&watcher_id)
    {
        stopped.store(true, Ordering::Relaxed);
    }
    Ok(())
}
