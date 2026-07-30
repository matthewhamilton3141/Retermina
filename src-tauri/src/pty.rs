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
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
    use tauri::ipc::Channel;

    use super::{AttachPtyOptions, CreatePtyOptions, PtyEvent};
    use crate::session_proto::{
        read_header_line, socket_path, AttachReply, CreateReply, Request,
    };

    /// A session lives either in the out-of-process host (survivable across an
    /// app restart) or, when the host can't be reached, in-process (works but
    /// doesn't survive — the fallback that keeps terminals working no matter
    /// what).
    enum Backend {
        /// Write half of the host data connection.
        Host(UnixStream),
        Local(LocalPty),
    }

    struct LocalPty {
        writer: Box<dyn Write + Send>,
        master: Box<dyn MasterPty + Send>,
        child: Box<dyn Child + Send + Sync>,
    }

    #[derive(Default)]
    pub struct PtyManager {
        inner: Mutex<Inner>,
        /// Id counter for in-process fallback sessions.
        local_ids: AtomicU64,
    }

    #[derive(Default)]
    struct Inner {
        sessions: HashMap<String, Backend>,
        bootstrapped: bool,
        /// Set once the host proves unreachable, so we stop paying the spawn
        /// timeout on every new terminal and go straight to the in-process path.
        host_unavailable: bool,
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

    /// Ensure a host is reachable: connect if one is already running (it may
    /// have survived a previous app process), otherwise spawn one — detached, so
    /// it outlives *this* app too — and wait for its socket.
    fn ensure_host(inner: &mut Inner) -> Result<(), String> {
        if inner.bootstrapped {
            return Ok(());
        }
        if connect().is_err() {
            // Re-exec *this* binary as the session host (handled in main.rs).
            // Same executable, so there's nothing extra to locate or bundle —
            // and it's already the signed, universal app binary in release.
            let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
            std::process::Command::new(&exe)
                .arg("__session-host")
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                // Own process group so a signal to the app's group can't take
                // the host down with it — the whole point of survival.
                .process_group(0)
                .spawn()
                .map_err(|e| format!("spawn session host: {e}"))?;

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

    /// Pump a session's raw output to the frontend channel, mirroring the old
    /// in-process reader thread's event contract. Generic over the source so it
    /// serves both a host socket (`UnixStream`) and a local PTY reader.
    fn spawn_reader<R: Read + Send + 'static>(mut reader: R, on_event: Channel<PtyEvent>) {
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break, // EOF → shell exited / host closed pipe
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

    /// Whether the host is usable. Bootstraps it on first call; if that fails,
    /// latches `host_unavailable` so every terminal from here on uses the
    /// in-process fallback without re-paying the spawn timeout.
    fn host_ready(inner: &mut Inner) -> bool {
        if inner.host_unavailable {
            return false;
        }
        // Escape hatch to force the in-process fallback (for testing it, or as an
        // emergency off-switch for the whole survival mechanism).
        if std::env::var_os("RETERMINA_DISABLE_SESSION_HOST").is_some() {
            inner.host_unavailable = true;
            return false;
        }
        if inner.bootstrapped {
            return true;
        }
        match ensure_host(inner) {
            Ok(()) => true,
            Err(e) => {
                eprintln!("[pty] session host unavailable, using in-process fallback: {e}");
                inner.host_unavailable = true;
                false
            }
        }
    }

    /// Ask the host to create a session; on success returns its id plus the read
    /// half to pump. Leaves `on_event` untouched (the caller only consumes it
    /// once the backend is decided), so a failure can cleanly fall back.
    fn host_create(inner: &mut Inner, options: &CreatePtyOptions) -> Result<(String, UnixStream), String> {
        let mut stream = connect().map_err(|e| e.to_string())?;
        send_request(
            &mut stream,
            &Request::Create {
                cwd: options.cwd.clone(),
                cols: options.cols.max(1),
                rows: options.rows.max(1),
                color_fgbg: options.color_fgbg.clone(),
            },
        )
        .map_err(|e| e.to_string())?;
        let line = read_header_line(&mut stream).map_err(|e| e.to_string())?;
        let reply: CreateReply =
            serde_json::from_str(&line).map_err(|_| format!("host rejected create: {line}"))?;
        let write_half = stream.try_clone().map_err(|e| e.to_string())?;
        inner.sessions.insert(reply.session_id.clone(), Backend::Host(write_half));
        Ok((reply.session_id, stream))
    }

    /// Spawn an in-process PTY (the fallback) — the same login-shell setup the
    /// host uses, kept here so terminals work even with no host.
    fn create_local(
        local_ids: &AtomicU64,
        inner: &mut Inner,
        options: CreatePtyOptions,
        on_event: Channel<PtyEvent>,
    ) -> Result<String, String> {
        let size = PtySize {
            rows: options.rows.max(1),
            cols: options.cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = native_pty_system().openpty(size).map_err(|e| e.to_string())?;
        let child = pair.slave.spawn_command(local_command(&options)).map_err(|e| e.to_string())?;
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        // Distinct id space so a persisted mapping to a local id simply misses on
        // reattach (host says "no such session") and creates fresh — correct,
        // since a local session never survived anyway.
        let id = format!("local-{}", local_ids.fetch_add(1, Ordering::Relaxed));
        spawn_reader(reader, on_event);
        inner.sessions.insert(id.clone(), Backend::Local(LocalPty { writer, master: pair.master, child }));
        Ok(id)
    }

    fn local_command(options: &CreatePtyOptions) -> CommandBuilder {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l");
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        if let Some(fgbg) = options.color_fgbg.clone().filter(|s| !s.is_empty()) {
            cmd.env("COLORFGBG", fgbg);
        }
        if let Some(dir) = resolve_cwd(options.cwd.clone()) {
            cmd.cwd(dir);
        }
        cmd
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

    #[tauri::command]
    pub fn create_pty_session(
        manager: tauri::State<'_, PtyManager>,
        options: CreatePtyOptions,
        on_event: Channel<PtyEvent>,
    ) -> Result<String, String> {
        let mut inner = manager.inner.lock().unwrap();
        if host_ready(&mut inner) {
            match host_create(&mut inner, &options) {
                Ok((id, read_half)) => {
                    spawn_reader(read_half, on_event);
                    return Ok(id);
                }
                Err(e) => {
                    // Host was up but this create failed — degrade to in-process
                    // rather than failing the terminal outright.
                    eprintln!("[pty] host create failed, using in-process fallback: {e}");
                    inner.host_unavailable = true;
                }
            }
        }
        create_local(&manager.local_ids, &mut inner, options, on_event)
    }

    #[tauri::command]
    pub fn attach_pty_session(
        manager: tauri::State<'_, PtyManager>,
        options: AttachPtyOptions,
        on_event: Channel<PtyEvent>,
    ) -> Result<bool, String> {
        let mut inner = manager.inner.lock().unwrap();
        if !host_ready(&mut inner) {
            return Ok(false); // no host → nothing survived; caller creates fresh
        }

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
        inner.sessions.insert(options.session_id.clone(), Backend::Host(write_half));
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
        match inner
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| format!("unknown pty session: {session_id}"))?
        {
            Backend::Host(stream) => {
                stream.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
                stream.flush().map_err(|e| e.to_string())
            }
            Backend::Local(pty) => {
                pty.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
                pty.writer.flush().map_err(|e| e.to_string())
            }
        }
    }

    #[tauri::command]
    pub fn resize_pty(
        manager: tauri::State<'_, PtyManager>,
        session_id: String,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        // Local sessions resize their PTY directly (under the lock); host
        // sessions get a one-shot control message so it never contends with the
        // raw data pipe.
        {
            let inner = manager.inner.lock().unwrap();
            match inner.sessions.get(&session_id) {
                Some(Backend::Local(pty)) => {
                    return pty
                        .master
                        .resize(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 })
                        .map_err(|e| e.to_string());
                }
                Some(Backend::Host(_)) => {} // handled below, after releasing the lock
                None => return Ok(()), // unknown session → no-op
            }
        }
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
        // Intentional close. For a host session: tell the host to kill the shell
        // (so it does NOT resurrect) then drop our connection. Detach-on-quit is
        // different — it happens implicitly when the app dies and its sockets
        // close, which the host treats as "keep alive for the grace window". For
        // a local session: kill the child directly.
        let backend = manager.inner.lock().unwrap().sessions.remove(&session_id);
        match backend {
            Some(Backend::Host(_)) => {
                if let Ok(mut stream) = connect() {
                    let _ = send_request(&mut stream, &Request::Close { session_id });
                    let _ = read_header_line(&mut stream);
                }
            }
            Some(Backend::Local(mut pty)) => {
                let _ = pty.child.kill();
                let _ = pty.child.wait();
            }
            None => {}
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
