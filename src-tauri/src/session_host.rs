//! The **session host**: a standalone process that owns every terminal's PTY so
//! the shells outlive the app that launched them. The Tauri app is a client
//! (`pty` module) that connects over a unix socket, and reconnects after a
//! quit/crash/update to find its sessions still running.
//!
//! Resource guardrails (so this never becomes a battery-draining daemon):
//!   * A session with no attached client for [`SESSION_TTL`] is reaped.
//!   * While the app is running it holds a [`Request::Keepalive`] connection;
//!     when that drops (app gone) the host starts a grace clock and, once the
//!     grace elapses (or there is simply nothing left to keep), reaps everything
//!     and **exits itself**.
//!
//! Run via the `session-host` binary (see `src/bin/session-host.rs`).

use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

use crate::session_proto::{
    read_header_line, socket_path, AttachReply, CreateReply, Request, SimpleReply,
};

/// Per-session replay cap. Large enough to feel like real scrollback came back,
/// bounded so a chatty long-running session can't grow host memory forever.
const RING_CAP: usize = 512 * 1024;

/// How long a detached (client-less) session is kept alive waiting for the app
/// to reattach before it's reaped. Covers quit/crash/update; a longer absence
/// is treated as "user is done".
const SESSION_TTL: Duration = Duration::from_secs(600);

/// Once the app is gone (no keepalive), exit this soon if there's nothing worth
/// preserving (no sessions), rather than lingering.
const IDLE_EXIT: Duration = Duration::from_secs(10);

/// Shared between a session's reader thread and its data connection, behind one
/// lock so "append to ring" and "fan out to client" are one critical section —
/// which is what makes reattach replay lossless (see `session_proto`).
struct Shared {
    ring: VecDeque<u8>,
    client: Option<UnixStream>,
    /// `None` while a client is attached; `Some(when)` since the last detach.
    detached_since: Option<Instant>,
}

struct Session {
    shared: Arc<Mutex<Shared>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}

#[derive(Default)]
struct Host {
    sessions: Mutex<HashMap<String, Session>>,
    next_id: AtomicU64,
    /// Count of open keepalive connections. >0 means an app is running.
    keepalives: AtomicUsize,
    /// When the keepalive count last fell to zero (the app went away).
    app_gone_since: Mutex<Option<Instant>>,
}

/// Entry point for the `session-host` binary.
pub fn run() {
    let path = socket_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }

    let listener = match UnixListener::bind(&path) {
        Ok(l) => l,
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            // Either another host already owns it, or a stale socket from an
            // uncleanly-killed host remains. Probe: if something answers, defer
            // to it; otherwise clear the stale file and take over.
            if UnixStream::connect(&path).is_ok() {
                eprintln!("[host] another host already listening; exiting");
                std::process::exit(0);
            }
            let _ = std::fs::remove_file(&path);
            UnixListener::bind(&path).expect("bind session-host socket")
        }
        Err(e) => panic!("bind session-host socket: {e}"),
    };

    let host = Arc::new(Host::default());
    spawn_reaper(Arc::clone(&host), path.clone());
    eprintln!("[host] listening on {}", path.display());

    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let host = Arc::clone(&host);
        thread::spawn(move || handle_connection(host, stream));
    }
}

fn handle_connection(host: Arc<Host>, mut stream: UnixStream) {
    let line = match read_header_line(&mut stream) {
        Ok(l) if !l.is_empty() => l,
        _ => return,
    };
    let req: Request = match serde_json::from_str(&line) {
        Ok(r) => r,
        Err(e) => {
            let _ = reply(&mut stream, &SimpleReply { ok: false, error: Some(format!("bad request: {e}")), sessions: None });
            return;
        }
    };

    match req {
        Request::Create { cwd, cols, rows, color_fgbg } => {
            handle_create(&host, stream, cwd, cols, rows, color_fgbg)
        }
        Request::Attach { session_id } => handle_attach(&host, stream, &session_id),
        Request::Resize { session_id, cols, rows } => {
            let ok = host
                .sessions
                .lock()
                .unwrap()
                .get(&session_id)
                .map(|s| {
                    s.master
                        .lock()
                        .unwrap()
                        .resize(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 })
                        .is_ok()
                })
                .unwrap_or(false);
            let _ = reply(&mut stream, &SimpleReply { ok, error: None, sessions: None });
        }
        Request::Close { session_id } => {
            if let Some(session) = host.sessions.lock().unwrap().remove(&session_id) {
                let mut child = session.child.lock().unwrap();
                let _ = child.kill();
                let _ = child.wait();
            }
            let _ = reply(&mut stream, &SimpleReply { ok: true, error: None, sessions: None });
        }
        Request::List => {
            let ids: Vec<String> = host.sessions.lock().unwrap().keys().cloned().collect();
            let _ = reply(&mut stream, &SimpleReply { ok: true, error: None, sessions: Some(ids) });
        }
        Request::Ping => {
            let _ = reply(&mut stream, &SimpleReply { ok: true, error: None, sessions: None });
        }
        Request::Keepalive => {
            // Hold the connection open; its lifetime == the app's lifetime.
            host.keepalives.fetch_add(1, Ordering::SeqCst);
            *host.app_gone_since.lock().unwrap() = None;
            let mut buf = [0u8; 64];
            loop {
                match stream.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {} // ignore any bytes; we only care about EOF
                }
            }
            if host.keepalives.fetch_sub(1, Ordering::SeqCst) == 1 {
                *host.app_gone_since.lock().unwrap() = Some(Instant::now());
            }
        }
    }
}

fn handle_create(
    host: &Arc<Host>,
    mut stream: UnixStream,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    color_fgbg: Option<String>,
) {
    let pair = match native_pty_system().openpty(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 }) {
        Ok(p) => p,
        Err(e) => {
            let _ = reply(&mut stream, &SimpleReply { ok: false, error: Some(e.to_string()), sessions: None });
            return;
        }
    };
    let child = match pair.slave.spawn_command(build_command(cwd, color_fgbg)) {
        Ok(c) => c,
        Err(e) => {
            let _ = reply(&mut stream, &SimpleReply { ok: false, error: Some(e.to_string()), sessions: None });
            return;
        }
    };
    drop(pair.slave); // master sees EOF when the shell exits

    let mut reader = match pair.master.try_clone_reader() {
        Ok(r) => r,
        Err(e) => {
            let _ = reply(&mut stream, &SimpleReply { ok: false, error: Some(e.to_string()), sessions: None });
            return;
        }
    };
    let writer = match pair.master.take_writer() {
        Ok(w) => w,
        Err(e) => {
            let _ = reply(&mut stream, &SimpleReply { ok: false, error: Some(e.to_string()), sessions: None });
            return;
        }
    };

    let id = format!("pty-{}", host.next_id.fetch_add(1, Ordering::Relaxed));
    let shared = Arc::new(Mutex::new(Shared { ring: VecDeque::new(), client: None, detached_since: None }));

    // Reader thread: shell output → ring + live client, one critical section.
    {
        let shared = Arc::clone(&shared);
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break, // shell exited
                    Ok(n) => {
                        let bytes = &buf[..n];
                        let mut s = shared.lock().unwrap();
                        for &b in bytes {
                            if s.ring.len() == RING_CAP {
                                s.ring.pop_front();
                            }
                            s.ring.push_back(b);
                        }
                        if let Some(client) = s.client.as_mut() {
                            if client.write_all(bytes).is_err() || client.flush().is_err() {
                                s.client = None;
                                s.detached_since = Some(Instant::now());
                            }
                        }
                    }
                }
            }
            // Shell exited: close the client so the app sees EOF → [process exited].
            let mut s = shared.lock().unwrap();
            s.client = None;
            s.detached_since = Some(Instant::now());
        });
    }

    let session = Session {
        shared: Arc::clone(&shared),
        writer: Arc::new(Mutex::new(writer)),
        master: Arc::new(Mutex::new(pair.master)),
        child: Arc::new(Mutex::new(child)),
    };
    let writer = Arc::clone(&session.writer);
    host.sessions.lock().unwrap().insert(id.clone(), session);

    if reply(&mut stream, &CreateReply { session_id: id.clone() }).is_err() {
        return;
    }
    eprintln!("[host] created {id}");
    serve_data_connection(shared, writer, stream);
}

fn handle_attach(host: &Arc<Host>, mut stream: UnixStream, session_id: &str) {
    let (shared, writer) = {
        let sessions = host.sessions.lock().unwrap();
        match sessions.get(session_id) {
            Some(s) => (Arc::clone(&s.shared), Arc::clone(&s.writer)),
            None => {
                let _ = reply(&mut stream, &AttachReply { ok: false, error: Some("no such session".into()) });
                return;
            }
        }
    };
    if reply(&mut stream, &AttachReply { ok: true, error: None }).is_err() {
        return;
    }
    // Replay scrollback + register as the live client, atomically vs the reader.
    {
        let mut s = shared.lock().unwrap();
        let snapshot: Vec<u8> = s.ring.iter().copied().collect();
        let mut w = match stream.try_clone() {
            Ok(w) => w,
            Err(_) => return,
        };
        let _ = w.set_write_timeout(Some(Duration::from_secs(5)));
        if w.write_all(&snapshot).is_err() || w.flush().is_err() {
            return;
        }
        s.client = Some(w);
        s.detached_since = None;
    }
    eprintln!("[host] reattached {session_id}");
    serve_data_connection(shared, writer, stream);
}

/// Register `stream` as the session's live client (for `Create`, where the
/// header reply already went out) and pump client input → PTY until detach.
fn serve_data_connection(
    shared: Arc<Mutex<Shared>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    mut read_half: UnixStream,
) {
    // For Create the client isn't registered yet; register the write half now.
    // (Attach already registered inside the replay critical section.)
    {
        let mut s = shared.lock().unwrap();
        if s.client.is_none() {
            if let Ok(w) = read_half.try_clone() {
                let _ = w.set_write_timeout(Some(Duration::from_secs(5)));
                s.client = Some(w);
                s.detached_since = None;
            }
        }
    }

    let mut buf = [0u8; 8192];
    loop {
        match read_half.read(&mut buf) {
            Ok(0) | Err(_) => break, // client detached (app quit / closed panel)
            Ok(n) => {
                let mut w = writer.lock().unwrap();
                if w.write_all(&buf[..n]).is_err() || w.flush().is_err() {
                    break;
                }
            }
        }
    }
    let mut s = shared.lock().unwrap();
    s.client = None;
    s.detached_since = Some(Instant::now());
}

/// Build the login-shell command — mirrors `pty::default_shell` + env so hosted
/// shells behave identically to the in-process ones they replace.
fn build_command(cwd: Option<String>, color_fgbg: Option<String>) -> CommandBuilder {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if let Some(fgbg) = color_fgbg.filter(|s| !s.is_empty()) {
        cmd.env("COLORFGBG", fgbg);
    }
    if let Some(dir) = resolve_cwd(cwd) {
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

fn reply<T: serde::Serialize>(stream: &mut UnixStream, value: &T) -> std::io::Result<()> {
    let mut line = serde_json::to_vec(value).unwrap_or_default();
    line.push(b'\n');
    stream.write_all(&line)?;
    stream.flush()
}

fn spawn_reaper(host: Arc<Host>, path: std::path::PathBuf) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(500));

        // Reap sessions whose shell exited or that no client reclaimed in time.
        {
            let mut sessions = host.sessions.lock().unwrap();
            let dead: Vec<String> = sessions
                .iter()
                .filter_map(|(id, s)| {
                    let exited = s.child.lock().unwrap().try_wait().ok().flatten().is_some();
                    let expired = {
                        let sh = s.shared.lock().unwrap();
                        matches!(sh.detached_since, Some(t) if t.elapsed() >= SESSION_TTL)
                    };
                    (exited || expired).then(|| id.clone())
                })
                .collect();
            for id in dead {
                if let Some(s) = sessions.remove(&id) {
                    let mut child = s.child.lock().unwrap();
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }

        // Self-exit once the app is gone and there's nothing left to preserve
        // (or the grace window has fully elapsed).
        if host.keepalives.load(Ordering::SeqCst) == 0 {
            let gone = *host.app_gone_since.lock().unwrap();
            if let Some(since) = gone {
                let empty = host.sessions.lock().unwrap().is_empty();
                if (empty && since.elapsed() >= IDLE_EXIT) || since.elapsed() >= SESSION_TTL {
                    eprintln!("[host] app gone, nothing to keep; exiting");
                    let _ = std::fs::remove_file(&path);
                    std::process::exit(0);
                }
            } else {
                // keepalive count is 0 but we never recorded when — record now
                // (covers a host that started before any app connected).
                *host.app_gone_since.lock().unwrap() = Some(Instant::now());
            }
        }
    });
}
