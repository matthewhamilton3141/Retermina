//! Native pseudo-terminal (PTY) backend.
//!
//! Each terminal viewport in the frontend owns one PTY session here. Output is
//! streamed back to the webview over a Tauri [`Channel`] as base64 chunks (raw
//! bytes survive transport intact; xterm.js handles UTF-8 reassembly). Input,
//! resize, and close travel the other way as ordinary `invoke` commands.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

/// Options supplied by the frontend when opening a terminal.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePtyOptions {
    /// Optional working directory. File paths resolve to their parent folder.
    pub cwd: Option<String>,
    /// Initial terminal dimensions (from xterm's fit addon).
    pub cols: u16,
    pub rows: u16,
    /// `COLORFGBG` value (e.g. `"0;15"` for dark-on-light) derived from the
    /// active theme, so CLI tools that probe it — Claude Code, vim, less — pick
    /// colours that stay legible instead of assuming a dark background.
    pub color_fgbg: Option<String>,
}

/// Messages streamed from a PTY session to the frontend.
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PtyEvent {
    /// A chunk of raw shell output, base64-encoded.
    Data { chunk: String },
    /// The shell process exited (EOF on the PTY).
    Exit { code: Option<i32> },
}

/// Live handles for a single PTY session, retained so input/resize/close
/// commands can reach the running shell.
struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

/// Tauri-managed state holding all active PTY sessions.
#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
    next_id: AtomicU64,
}

/// Resolve an optional cwd: keep directories, map files to their parent, and
/// drop anything that doesn't exist (the shell then starts in its default dir).
fn resolve_cwd(cwd: Option<String>) -> Option<std::path::PathBuf> {
    let path = std::path::PathBuf::from(cwd?);
    if path.is_dir() {
        Some(path)
    } else if path.is_file() {
        path.parent().map(|p| p.to_path_buf())
    } else {
        None
    }
}

/// Build the command for the user's native shell.
fn default_shell() -> CommandBuilder {
    if cfg!(windows) {
        // PowerShell resolves via PATH; cmd.exe is the implicit fallback.
        CommandBuilder::new("powershell.exe")
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let mut cmd = CommandBuilder::new(&shell);
        // -l (login shell) causes the shell to source /etc/profile and
        // ~/.zprofile / ~/.bash_profile on startup. Without this, Tauri's GUI
        // process inherits a bare launchd PATH (/usr/bin:/bin only), so npm,
        // git, brew-installed tools, and nvm/rbenv/pyenv shims are all missing.
        cmd.arg("-l");
        cmd
    }
}

/// Open a new PTY, spawn the shell, and stream its output over `on_event`.
/// Returns the session id used by the other PTY commands.
#[tauri::command]
pub fn create_pty_session(
    manager: tauri::State<'_, PtyManager>,
    options: CreatePtyOptions,
    on_event: Channel<PtyEvent>,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let size = PtySize {
        rows: options.rows.max(1),
        cols: options.cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system.openpty(size).map_err(|e| e.to_string())?;

    let mut cmd = default_shell();
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    // Advertise the terminal's light/dark-ness so CLI tools choose readable
    // colours. Read once at process start, so it tracks the theme active when a
    // shell is spawned, not later live theme switches.
    if let Some(fgbg) = options.color_fgbg.filter(|s| !s.is_empty()) {
        cmd.env("COLORFGBG", fgbg);
    }
    if let Some(dir) = resolve_cwd(options.cwd) {
        cmd.cwd(dir);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // Drop our handle to the slave so the master sees EOF when the child exits.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let id = manager.next_id.fetch_add(1, Ordering::Relaxed);
    let session_id = format!("pty-{id}");

    // Reader thread: pump shell output to the frontend until EOF.
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF: shell exited
                Ok(n) => {
                    let chunk = STANDARD.encode(&buf[..n]);
                    if on_event.send(PtyEvent::Data { chunk }).is_err() {
                        break; // frontend channel closed
                    }
                }
                Err(_) => break,
            }
        }
        let _ = on_event.send(PtyEvent::Exit { code: None });
    });

    manager.sessions.lock().unwrap().insert(
        session_id.clone(),
        PtySession {
            master: pair.master,
            writer,
            child,
        },
    );

    Ok(session_id)
}

/// Write user input (keystrokes / paste) to a session's shell.
#[tauri::command]
pub fn write_to_pty(
    manager: tauri::State<'_, PtyManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = manager.sessions.lock().unwrap();
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("unknown pty session: {session_id}"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// Resize a session's PTY to match the frontend terminal geometry.
#[tauri::command]
pub fn resize_pty(
    manager: tauri::State<'_, PtyManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = manager.sessions.lock().unwrap();
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("unknown pty session: {session_id}"))?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Terminate a session's shell and forget the session.
#[tauri::command]
pub fn close_pty(manager: tauri::State<'_, PtyManager>, session_id: String) -> Result<(), String> {
    if let Some(mut session) = manager.sessions.lock().unwrap().remove(&session_id) {
        let _ = session.child.kill();
    }
    Ok(())
}
