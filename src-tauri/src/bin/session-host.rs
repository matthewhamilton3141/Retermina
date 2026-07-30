//! The `session-host` binary: a tiny wrapper around
//! [`retermina_lib::session_host::run`]. Shipped alongside the app as a sidecar
//! so terminal PTYs live in this process and outlive the app window.

#[cfg(unix)]
fn main() {
    retermina_lib::session_host::run();
}

// The live-session host is unix-only for now (unix-domain sockets + PTY model);
// Windows keeps the in-process terminal path. This stub keeps the target
// buildable everywhere.
#[cfg(not(unix))]
fn main() {
    eprintln!("session-host is not supported on this platform");
}
