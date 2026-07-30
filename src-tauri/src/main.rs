// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The app re-execs *itself* with this hidden argument to run the terminal
    // session host out-of-process (see `pty.rs`). Handling it here, before the
    // GUI boots, means the host ships as the very same universal, signed,
    // already-bundled binary — no separate sidecar to build, lipo, or bundle.
    // Runs the socket loop and never returns to the GUI path.
    #[cfg(unix)]
    if std::env::args().nth(1).as_deref() == Some("__session-host") {
        retermina_lib::session_host::run();
        return;
    }
    retermina_lib::run()
}
