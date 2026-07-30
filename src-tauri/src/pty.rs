//! Terminal backend, frontend-facing.
//!
//! On unix this is a **thin client of the session host** (`session_host`): PTYs
//! live in that separate process so shells survive an app quit/crash/update, and
//! the app reconnects to them. The frontend contract is unchanged — the same
//! `create_pty_session` / `write_to_pty` / `resize_pty` / `close_pty` commands
//! and the same `PtyEvent` channel — plus a new `attach_pty_session` for
//! reconnecting to a session that outlived the previous process.
//!
//! On non-unix (Windows) the host isn't available yet, so we keep the original
//! **in-process** PTY implementation; terminals work but don't survive a
//! restart.

use serde::{Deserialize, Serialize};

/// Options supplied by the frontend when opening a terminal.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePtyOptions {
    /// Optional working directory. File paths resolve to their parent folder.
    pub cwd: Option<String>,
    /// Initial terminal dimensions (from xterm's fit addon).
    pub cols: u16,
    pub rows: u16,
    /// `COLORFGBG` value derived from the active theme (see the original notes).
    pub color_fgbg: Option<String>,
}

/// Options for reconnecting to a session that outlived the previous app process.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachPtyOptions {
    /// The host session id recorded when the session was first created.
    pub session_id: String,
    /// Current viewport size, so the reattached PTY is resized to match.
    pub cols: u16,
    pub rows: u16,
}

/// Messages streamed from a PTY session to the frontend.
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PtyEvent {
    /// A chunk of raw shell output, base64-encoded.
    Data { chunk: String },
    /// The shell process exited (EOF on the PTY / host closed the pipe).
    Exit { code: Option<i32> },
}

// ===========================================================================
// unix: client of the session host
// ===========================================================================
#[cfg(unix)]
mod unix_impl {
    use std::collections::HashMap;
    use std::io::{Read, Write};
    use std::os::unix::net::UnixStream;
    use std::os::unix::process::CommandExt;
    use std::path::PathBuf;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use tauri::ipc::Channel;

    use super::{AttachPtyOptions, CreatePtyOptions, PtyEvent};
    use crate::session_proto::{
        read_header_line, socket_path, AttachReply, CreateReply, Request,
    };

    /// Client-side state: the write half of each session's data connection
    /// (keyed by host session id), plus one-time host bootstrap.
    #[derive(Default)]
    pub struct PtyManager {
        inner: Mutex<Inner>,
    }

    #[derive(Default)]
    struct Inner {
        sessions: HashMap<String, UnixStream>,
        bootstrapped: bool,
        /// Held open for the app's lifetime so the host knows the app is alive.
        _keepalive: Option<UnixStream>,
    }

    fn connect() -> std::io::Result<UnixStream> {
        UnixStream::connect(socket_path())
    }

    fn send_request(stream: &mut UnixStream, req: &Request) -> std::io::Result<()> {
        let mut line = serde_json::to_vec(req).unwrap_or_default();
        line.push(b'\n');
        stream.write_all(&line)?;
        stream.flush()
    }

    /// Locate the `session-host` binary — next to the app executable (dev:
    /// `target/debug/session-host`; release: the bundled sidecar).
    fn host_binary_path() -> Option<PathBuf> {
        let exe = std::env::current_exe().ok()?;
        let dir = exe.parent()?;
        let direct = dir.join("session-host");
        if direct.exists() {
            return Some(direct);
        }
        // Sidecars are named with a target-triple suffix; take the first match.
        for entry in std::fs::read_dir(dir).ok()?.flatten() {
            if entry.file_name().to_string_lossy().starts_with("session-host") {
                return Some(entry.path());
            }
        }
        None
    }

    /// Ensure a host is reachable: connect if one is already running (it may
    /// have survived a previous app process), otherwise spawn one — detached, so
    /// it outlives *this* app too — and wait for its socket.
    fn ensure_host(inner: &mut Inner) -> Result<(), String> {
        if inner.bootstrapped {
            return Ok(());
        }
        if connect().is_err() {
            let bin = host_binary_path().ok_or("session-host binary not found")?;
            std::process::Command::new(&bin)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                // Own process group so a signal to the app's group can't take
                // the host down with it — the whole point of survival.
                .process_group(0)
                .spawn()
                .map_err(|e| format!("spawn session-host: {e}"))?;

            let deadline = Instant::now() + Duration::from_secs(5);
            while connect().is_err() {
                if Instant::now() >= deadline {
                    return Err("session-host did not come up".into());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        // Hold a keepalive connection open for the app's lifetime.
        let mut ka = connect().map_err(|e| e.to_string())?;
        send_request(&mut ka, &Request::Keepalive).map_err(|e| e.to_string())?;
        inner._keepalive = Some(ka);
        inner.bootstrapped = true;
        Ok(())
    }

    /// Pump a session's raw output from the host socket to the frontend channel,
    /// exactly mirroring the old in-process reader thread's event contract.
    fn spawn_reader(mut read_half: UnixStream, on_event: Channel<PtyEvent>) {
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match read_half.read(&mut buf) {
                    Ok(0) | Err(_) => break, // host closed pipe → shell exited
                    Ok(n) => {
                        let chunk = STANDARD.encode(&buf[..n]);
                        if on_event.send(PtyEvent::Data { chunk }).is_err() {
                            break; // frontend channel closed
                        }
                    }
                }
            }
            let _ = on_event.send(PtyEvent::Exit { code: None });
        });
    }

    #[tauri::command]
    pub fn create_pty_session(
        manager: tauri::State<'_, PtyManager>,
        options: CreatePtyOptions,
        on_event: Channel<PtyEvent>,
    ) -> Result<String, String> {
        let mut inner = manager.inner.lock().unwrap();
        ensure_host(&mut inner)?;

        let mut stream = connect().map_err(|e| e.to_string())?;
        send_request(
            &mut stream,
            &Request::Create {
                cwd: options.cwd,
                cols: options.cols.max(1),
                rows: options.rows.max(1),
                color_fgbg: options.color_fgbg,
            },
        )
        .map_err(|e| e.to_string())?;

        let line = read_header_line(&mut stream).map_err(|e| e.to_string())?;
        let reply: CreateReply = serde_json::from_str(&line)
            .map_err(|_| format!("host rejected create: {line}"))?;

        let write_half = stream.try_clone().map_err(|e| e.to_string())?;
        spawn_reader(stream, on_event);
        inner.sessions.insert(reply.session_id.clone(), write_half);
        Ok(reply.session_id)
    }

    #[tauri::command]
    pub fn attach_pty_session(
        manager: tauri::State<'_, PtyManager>,
        options: AttachPtyOptions,
        on_event: Channel<PtyEvent>,
    ) -> Result<bool, String> {
        let mut inner = manager.inner.lock().unwrap();
        ensure_host(&mut inner)?;

        let mut stream = match connect() {
            Ok(s) => s,
            Err(_) => return Ok(false), // no host → nothing to reattach to
        };
        if send_request(&mut stream, &Request::Attach { session_id: options.session_id.clone() }).is_err() {
            return Ok(false);
        }
        let line = read_header_line(&mut stream).map_err(|e| e.to_string())?;
        let reply: AttachReply =
            serde_json::from_str(&line).map_err(|_| format!("bad attach reply: {line}"))?;
        if !reply.ok {
            return Ok(false); // session gone (reaped / host restarted) → caller falls back to create
        }

        let write_half = stream.try_clone().map_err(|e| e.to_string())?;
        spawn_reader(stream, on_event);
        inner.sessions.insert(options.session_id.clone(), write_half);
        drop(inner);

        // Match the reattached PTY to the current viewport.
        let _ = resize_pty(manager, options.session_id, options.cols, options.rows);
        Ok(true)
    }

    #[tauri::command]
    pub fn write_to_pty(
        manager: tauri::State<'_, PtyManager>,
        session_id: String,
        data: String,
    ) -> Result<(), String> {
        let mut inner = manager.inner.lock().unwrap();
        let stream = inner
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| format!("unknown pty session: {session_id}"))?;
        stream.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        stream.flush().map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn resize_pty(
        manager: tauri::State<'_, PtyManager>,
        session_id: String,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        // Resize is a one-shot control message so it never contends with the
        // session's raw data pipe.
        let _ = manager; // control ops don't need session state
        let mut stream = connect().map_err(|e| e.to_string())?;
        send_request(&mut stream, &Request::Resize { session_id, cols, rows })
            .map_err(|e| e.to_string())?;
        let _ = read_header_line(&mut stream); // drain the ack
        Ok(())
    }

    #[tauri::command]
    pub fn close_pty(
        manager: tauri::State<'_, PtyManager>,
        session_id: String,
    ) -> Result<(), String> {
        // Intentional close: tell the host to kill the shell (so it does NOT
        // resurrect), then drop our data connection. Detach-on-quit is different
        // — it happens implicitly when the app process dies and its sockets
        // close, which the host treats as "keep alive for the grace window".
        let mut inner = manager.inner.lock().unwrap();
        inner.sessions.remove(&session_id);
        drop(inner);

        if let Ok(mut stream) = connect() {
            let _ = send_request(&mut stream, &Request::Close { session_id });
            let _ = read_header_line(&mut stream);
        }
        Ok(())
    }
}

// ===========================================================================
// non-unix: original in-process PTY (no cross-restart survival)
// ===========================================================================
#[cfg(not(unix))]
mod portable_impl {
    use std::collections::HashMap;
    use std::io::{Read, Write};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;

    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
    use tauri::ipc::Channel;

    use super::{AttachPtyOptions, CreatePtyOptions, PtyEvent};

    struct PtySession {
        master: Box<dyn MasterPty + Send>,
        writer: Box<dyn Write + Send>,
        child: Box<dyn Child + Send + Sync>,
    }

    #[derive(Default)]
    pub struct PtyManager {
        sessions: Mutex<HashMap<String, PtySession>>,
        next_id: AtomicU64,
    }

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

    fn default_shell() -> CommandBuilder {
        CommandBuilder::new("powershell.exe")
    }

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
        if let Some(fgbg) = options.color_fgbg.filter(|s| !s.is_empty()) {
            cmd.env("COLORFGBG", fgbg);
        }
        if let Some(dir) = resolve_cwd(options.cwd) {
            cmd.cwd(dir);
        }

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        let id = manager.next_id.fetch_add(1, Ordering::Relaxed);
        let session_id = format!("pty-{id}");

        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = STANDARD.encode(&buf[..n]);
                        if on_event.send(PtyEvent::Data { chunk }).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let _ = on_event.send(PtyEvent::Exit { code: None });
        });

        manager.sessions.lock().unwrap().insert(
            session_id.clone(),
            PtySession { master: pair.master, writer, child },
        );
        Ok(session_id)
    }

    /// Windows has no host yet, so there's never a surviving session to reattach.
    #[tauri::command]
    pub fn attach_pty_session(
        _manager: tauri::State<'_, PtyManager>,
        _options: AttachPtyOptions,
        _on_event: Channel<PtyEvent>,
    ) -> Result<bool, String> {
        Ok(false)
    }

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
        session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    }

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
            .resize(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[tauri::command]
    pub fn close_pty(
        manager: tauri::State<'_, PtyManager>,
        session_id: String,
    ) -> Result<(), String> {
        if let Some(mut session) = manager.sessions.lock().unwrap().remove(&session_id) {
            let _ = session.child.kill();
            let _ = session.child.wait();
        }
        Ok(())
    }
}

#[cfg(unix)]
pub use unix_impl::*;
#[cfg(not(unix))]
pub use portable_impl::*;
