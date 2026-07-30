//! Wire protocol shared by the session host (`session_host`) and the app-side
//! client (`pty`).
//!
//! Every connection opens with exactly one newline-terminated JSON [`Request`],
//! then behaves per its op:
//!   * `Create` / `Attach` — the host replies with one JSON line, after which
//!     the socket becomes a **raw byte pipe** for that PTY (output ← host,
//!     input → host). For `Attach` the reply is immediately followed by the
//!     replayed scrollback, still as raw bytes.
//!   * `Resize` / `Close` / `List` / `Ping` — one JSON reply, then the host
//!     closes the connection.
//!   * `Keepalive` — the host holds the connection open and never replies; the
//!     app keeps exactly one open for its lifetime so the host knows the app is
//!     alive. When it drops, the host starts its grace/reaper clock.
//!
//! Because a header line and raw bytes share one stream, the header must be read
//! one byte at a time up to the newline (a buffered reader would swallow raw
//! bytes into its buffer). See [`read_header_line`].

use std::io::{self, Read};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Stable socket path in the user's data dir, so a relaunched app finds a host
/// that survived the previous process. Falls back to the temp dir.
///
/// Overridable via `RETERMINA_SESSION_SOCK` (used by tests to point host and
/// client at a throwaway socket instead of the real one).
pub fn socket_path() -> PathBuf {
    if let Ok(p) = std::env::var("RETERMINA_SESSION_SOCK") {
        return PathBuf::from(p);
    }
    let base = dirs::data_dir().unwrap_or_else(std::env::temp_dir);
    base.join("retermina").join("session-host.sock")
}

/// Requests the app sends to the host (one per connection, as the first line).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Request {
    /// Open a fresh PTY + shell; reply is [`CreateReply`], then a raw pipe.
    Create {
        cwd: Option<String>,
        cols: u16,
        rows: u16,
        color_fgbg: Option<String>,
    },
    /// Reattach to a session that outlived the previous app process; reply is
    /// [`AttachReply`], then (if ok) replayed scrollback + a raw pipe.
    Attach { session_id: String },
    /// Resize an existing session's PTY. Reply [`SimpleReply`], then close.
    Resize {
        session_id: String,
        cols: u16,
        rows: u16,
    },
    /// Kill + forget a session (an intentional close — must not resurrect).
    Close { session_id: String },
    /// List live session ids (diagnostics / GC).
    List,
    /// Liveness probe used during host discovery.
    Ping,
    /// Held open for the app's lifetime; its drop tells the host the app is gone.
    Keepalive,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReply {
    pub session_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachReply {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleReply {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Populated for `List`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sessions: Option<Vec<String>>,
}

/// Read a single newline-terminated header line without over-reading into the
/// raw byte stream that follows. Returns the line without the trailing `\n`.
pub fn read_header_line(reader: &mut impl Read) -> io::Result<String> {
    let mut bytes = Vec::with_capacity(128);
    let mut one = [0u8; 1];
    loop {
        let n = reader.read(&mut one)?;
        if n == 0 {
            break; // EOF before newline
        }
        if one[0] == b'\n' {
            break;
        }
        bytes.push(one[0]);
        if bytes.len() > 64 * 1024 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "header line too long",
            ));
        }
    }
    String::from_utf8(bytes).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}
