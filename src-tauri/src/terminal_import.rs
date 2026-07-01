//! Detect the current working directory of the most recently active terminal
//! emulator on macOS so the user can jump straight into that path in Retermina.
//!
//! Strategy (tried in order):
//!   1. Terminal.app — AppleScript `tty of front window`, then lsof the tty
//!   2. iTerm2       — same via iTerm2 AppleScript
//!   3. Warp         — same via Warp AppleScript (tty of current pane)
//!   4. Ghostty      — shell fallback (pgrep newest zsh/bash/fish)
//!   5. Generic      — pgrep newest shell process
//!
//! We never run commands inside the user's shell (no `do script`). All cwd
//! reads go through `lsof -p <pid> -d cwd -Fn` which is read-only and safe.

use std::process::Command;

/// Read the cwd of process `pid` via `lsof`.
fn cwd_of_pid(pid: u32) -> Option<String> {
    let out = Command::new("lsof")
        .args(["-p", &pid.to_string(), "-d", "cwd", "-Fn"])
        .output()
        .ok()?;
    // lsof -Fn lines: "p<pid>" then "n<path>"
    String::from_utf8(out.stdout)
        .ok()?
        .lines()
        .find(|l| l.starts_with('n'))
        .map(|l| l[1..].to_string())
}

/// Find the shell process (zsh/bash/fish) listening on a tty device.
/// Returns the numerically lowest PID (the session leader / parent shell).
fn shell_pid_on_tty(tty: &str) -> Option<u32> {
    let out = Command::new("lsof")
        .args(["-t", tty])
        .output()
        .ok()?;
    String::from_utf8(out.stdout)
        .ok()?
        .lines()
        .filter_map(|l| l.trim().parse::<u32>().ok())
        .min()
}

/// Run a one-line AppleScript and return trimmed stdout, or None on failure.
fn applescript(script: &str) -> Option<String> {
    let out = Command::new("osascript").args(["-e", script]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8(out.stdout).ok()?.trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

fn terminal_app_cwd() -> Option<String> {
    let tty = applescript(
        r#"tell application "Terminal" to tty of front window"#,
    )?;
    shell_pid_on_tty(&tty).and_then(cwd_of_pid)
}

fn iterm2_cwd() -> Option<String> {
    let tty = applescript(
        r#"tell application "iTerm2" to tty of current session of current tab of current window"#,
    )?;
    shell_pid_on_tty(&tty).and_then(cwd_of_pid)
}

fn warp_cwd() -> Option<String> {
    // Warp exposes limited AppleScript; try to get the active pane's tty.
    let tty = applescript(
        r#"tell application "Warp" to tty of front window"#,
    )?;
    shell_pid_on_tty(&tty).and_then(cwd_of_pid)
}

fn shell_fallback_cwd() -> Option<String> {
    // pgrep -n returns the newest (most recently started) matching PID.
    for shell in &["zsh", "bash", "fish"] {
        if let Ok(out) = Command::new("pgrep")
            .args(["-n", "-x", shell])
            .output()
        {
            if let Ok(s) = String::from_utf8(out.stdout) {
                if let Ok(pid) = s.trim().parse::<u32>() {
                    if let Some(cwd) = cwd_of_pid(pid) {
                        return Some(cwd);
                    }
                }
            }
        }
    }
    None
}

/// Return the name of the first terminal app found running, for display
/// purposes in the frontend ("Importing from Terminal.app…").
fn detected_app_name() -> &'static str {
    let apps = [
        ("Terminal", "Terminal.app"),
        ("iTerm2",   "iTerm2"),
        ("Warp",     "Warp"),
        ("Ghostty",  "Ghostty"),
        ("Hyper",    "Hyper"),
        ("Alacritty","Alacritty"),
        ("kitty",    "kitty"),
    ];
    for (proc_name, label) in &apps {
        if let Ok(out) = Command::new("pgrep").args(["-x", proc_name]).output() {
            if out.status.success() {
                return label;
            }
        }
    }
    "Terminal"
}

#[derive(serde::Serialize)]
pub struct TerminalImport {
    pub cwd: String,
    pub app: String,
}

/// Detect the cwd of the most recently active terminal session.
///
/// Tries Terminal.app → iTerm2 → Warp → generic shell fallback.
/// Returns an error string if nothing is found.
#[tauri::command]
pub fn get_terminal_cwd() -> Result<TerminalImport, String> {
    let app = detected_app_name().to_string();

    let cwd = terminal_app_cwd()
        .or_else(iterm2_cwd)
        .or_else(warp_cwd)
        .or_else(shell_fallback_cwd)
        .ok_or_else(|| {
            "No active terminal session detected. Make sure Terminal.app, \
             iTerm2, or another terminal is running."
                .to_string()
        })?;

    Ok(TerminalImport { cwd, app })
}
