//! Managed Claude Code "agent" subprocess, driven over the stream-json protocol.
//!
//! Unlike the interactive TUI (which runs in a PTY and does not reliably persist
//! its transcript for a UI to tail), this drives Claude in its programmatic
//! streaming mode:
//!
//!   claude -p --output-format stream-json --input-format stream-json --verbose \
//!          --session-id <id> --permission-mode <mode> [--model <m>]
//!
//! The app writes one JSON user message per turn to the child's stdin and reads
//! structured events (system/init, assistant, user/tool_result, result …) line
//! by line from its stdout, forwarding each to the webview. One long-lived child
//! serves the whole conversation (stdin is held open across turns). Because the
//! session is `--session-id`/`--resume`-addressable and persists to disk, the
//! interactive CLI view can `--resume` the very same conversation on demand.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::ipc::Channel;

#[derive(Default)]
pub struct ClaudeAgentManager {
    agents: Mutex<HashMap<String, Arc<Mutex<AgentHandle>>>>,
    next_id: AtomicU64,
}

struct AgentHandle {
    child: Child,
    stdin: Option<ChildStdin>,
    interrupt_seq: u64,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClaudeAgentEvent {
    /// One parsed stream-json record straight from Claude's stdout.
    Record { record: Value },
    /// Non-fatal diagnostic text (a stderr line).
    Notice { message: String },
    /// The child exited; the agent view should mark the session done.
    Exit { code: Option<i32> },
}

fn valid_session_id(session_id: &str) -> bool {
    !session_id.is_empty()
        && session_id.len() <= 128
        && session_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
}

fn resolve_dir(cwd: Option<String>) -> Option<std::path::PathBuf> {
    let path = std::path::PathBuf::from(cwd?);
    if path.is_dir() {
        Some(path)
    } else if path.is_file() {
        path.parent().map(|p| p.to_path_buf())
    } else {
        None
    }
}

/// Single-quote a value for safe embedding in the `-lc` shell string. All of our
/// values are known tokens (uuid, permission mode, model alias), but quoting
/// keeps the command robust regardless.
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn permission_mode_arg(mode: &str) -> &str {
    match mode {
        "acceptEdits" | "auto" | "bypassPermissions" | "default" | "dontAsk" | "plan" => mode,
        // Anything unrecognized maps to the safe default so the flag never
        // rejects the launch.
        _ => "default",
    }
}

/// Spawn a stream-json Claude session. Returns a handle id used by the other
/// agent commands. `resume` picks `--resume` (continue a persisted session) over
/// `--session-id` (start it).
#[tauri::command]
pub fn start_claude_agent(
    manager: tauri::State<'_, ClaudeAgentManager>,
    cwd: Option<String>,
    session_id: String,
    permission_mode: String,
    model: Option<String>,
    resume: bool,
    on_event: Channel<ClaudeAgentEvent>,
) -> Result<String, String> {
    if !valid_session_id(&session_id) {
        return Err("invalid Claude session id".into());
    }

    // `exec` replaces the login shell with Claude so the spawned child PID *is*
    // Claude — killing it (on stop/restart) actually terminates Claude and frees
    // the session id immediately, instead of orphaning it under a dead shell
    // (which would leak and make the next `--session-id` launch collide).
    let mut claude = String::from(
        "exec claude -p --output-format stream-json --input-format stream-json \
         --include-partial-messages --verbose",
    );
    if resume {
        claude.push_str(&format!(" --resume {}", shell_quote(&session_id)));
    } else {
        claude.push_str(&format!(" --session-id {}", shell_quote(&session_id)));
    }
    claude.push_str(&format!(
        " --permission-mode {}",
        permission_mode_arg(&permission_mode)
    ));
    if let Some(model) = model.filter(|m| m != "default" && !m.is_empty()) {
        claude.push_str(&format!(" --model {}", shell_quote(&model)));
    }

    // Run through a login shell so a GUI-launched app inherits the user's full
    // PATH (where `claude`/`node` actually live).
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut cmd = Command::new(shell);
    cmd.arg("-lc")
        .arg(&claude)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = resolve_dir(cwd) {
        cmd.current_dir(dir);
    }

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().ok_or("no child stdout")?;
    let stderr = child.stderr.take().ok_or("no child stderr")?;
    let stdin = child.stdin.take();

    let id = manager.next_id.fetch_add(1, Ordering::Relaxed);
    let handle_id = format!("claude-agent-{id}");

    // stdout: one JSON record per line → forward. EOF ends the turn stream and
    // means the child exited, so emit Exit from here.
    let events = on_event.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(record) = serde_json::from_str::<Value>(trimmed) {
                if events.send(ClaudeAgentEvent::Record { record }).is_err() {
                    break;
                }
            }
        }
        let _ = events.send(ClaudeAgentEvent::Exit { code: None });
    });

    // stderr: surface as notices (auth/limit warnings etc.) without killing.
    let notices = on_event.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            if notices
                .send(ClaudeAgentEvent::Notice { message: line })
                .is_err()
            {
                break;
            }
        }
    });

    manager
        .agents
        .lock()
        .map_err(|_| "Claude agent lock poisoned".to_string())?
        .insert(
            handle_id.clone(),
            Arc::new(Mutex::new(AgentHandle {
                child,
                stdin,
                interrupt_seq: 0,
            })),
        );

    Ok(handle_id)
}

fn agent_handle(
    manager: &ClaudeAgentManager,
    handle_id: &str,
) -> Result<Arc<Mutex<AgentHandle>>, String> {
    manager
        .agents
        .lock()
        .map_err(|_| "Claude agent lock poisoned".to_string())?
        .get(handle_id)
        .cloned()
        .ok_or_else(|| format!("unknown Claude agent: {handle_id}"))
}

/// Send one user turn to a running agent as a stream-json user message.
#[tauri::command]
pub fn send_claude_agent(
    manager: tauri::State<'_, ClaudeAgentManager>,
    handle_id: String,
    text: String,
) -> Result<(), String> {
    let handle = agent_handle(&manager, &handle_id)?;
    let mut handle = handle.lock().map_err(|_| "Claude agent lock poisoned")?;
    let message = json!({
        "type": "user",
        "message": { "role": "user", "content": text }
    });
    let line = format!("{message}\n");
    let stdin = handle.stdin.as_mut().ok_or("agent stdin is closed")?;
    stdin
        .write_all(line.as_bytes())
        .map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// Cancel the in-flight turn via the stream-json control protocol.
#[tauri::command]
pub fn interrupt_claude_agent(
    manager: tauri::State<'_, ClaudeAgentManager>,
    handle_id: String,
) -> Result<(), String> {
    let handle = agent_handle(&manager, &handle_id)?;
    let mut handle = handle.lock().map_err(|_| "Claude agent lock poisoned")?;
    handle.interrupt_seq += 1;
    let request_id = format!("interrupt-{}", handle.interrupt_seq);
    let control = json!({
        "type": "control_request",
        "request_id": request_id,
        "request": { "subtype": "interrupt" }
    });
    let line = format!("{control}\n");
    let stdin = handle.stdin.as_mut().ok_or("agent stdin is closed")?;
    stdin
        .write_all(line.as_bytes())
        .map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// Kill an agent subprocess and forget it.
#[tauri::command]
pub fn stop_claude_agent(
    manager: tauri::State<'_, ClaudeAgentManager>,
    handle_id: String,
) -> Result<(), String> {
    let handle = manager
        .agents
        .lock()
        .map_err(|_| "Claude agent lock poisoned".to_string())?
        .remove(&handle_id);
    if let Some(handle) = handle {
        if let Ok(mut handle) = handle.lock() {
            // Dropping stdin first lets Claude see EOF and exit cleanly; kill is
            // the backstop.
            handle.stdin.take();
            let _ = handle.child.kill();
            let _ = handle.child.wait();
        }
    }
    Ok(())
}
