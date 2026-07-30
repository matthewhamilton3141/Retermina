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
use std::net::{TcpListener, TcpStream};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::ipc::Channel;

/// Bridges the headless Agent process's `AskUserQuestion`-equivalent to this
/// app's own UI. The built-in `AskUserQuestion` tool auto-resolves with empty
/// answers whenever Claude Code detects no interactive terminal — that's
/// hardcoded, not a permission setting, so it can never work in `-p`
/// stream-json mode. Instead each Agent process gets its own single-tool MCP
/// server: a tiny Node relay (this script) piping stdio to a TCP socket this
/// Rust process listens on, where the real JSON-RPC handling happens. MCP
/// tool calls go through the normal tool_use/tool_result flow (confirmed
/// empirically), so this sidesteps the no-TTY auto-deny entirely.
const MCP_ASK_BRIDGE_JS: &str = include_str!("mcp_ask_bridge.js");
const MCP_ASK_TOOL_NAME: &str = "ask_user_question";
const MCP_ASK_SERVER_NAME: &str = "retermina";

fn write_bridge_script() -> std::io::Result<std::path::PathBuf> {
    let path = std::env::temp_dir().join("retermina-mcp-ask-bridge.js");
    std::fs::write(&path, MCP_ASK_BRIDGE_JS)?;
    Ok(path)
}

#[derive(Default)]
pub struct ClaudeAgentManager {
    agents: Mutex<HashMap<String, Arc<Mutex<AgentHandle>>>>,
    next_id: AtomicU64,
}

struct AgentHandle {
    child: Child,
    stdin: Option<ChildStdin>,
    interrupt_seq: u64,
    /// Sender for whichever `ask_user_question` MCP call is currently
    /// blocked waiting on an answer (at most one at a time — the agent
    /// process can't continue past a pending question to ask another).
    mcp_answer_tx: Arc<Mutex<Option<mpsc::Sender<String>>>>,
    /// The bridge's TCP connection, kept only so `stop_claude_agent` can
    /// shut it down and unblock the listener thread on teardown.
    mcp_stream: Arc<Mutex<Option<TcpStream>>>,
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

    let mcp_listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let mcp_port = mcp_listener.local_addr().map_err(|e| e.to_string())?.port();
    let bridge_path = write_bridge_script().map_err(|e| e.to_string())?;
    let mcp_config = json!({
        "mcpServers": {
            MCP_ASK_SERVER_NAME: {
                "command": "node",
                "args": [bridge_path.to_string_lossy(), "--", mcp_port.to_string()]
            }
        }
    })
    .to_string();
    let mcp_tool_name = format!("mcp__{MCP_ASK_SERVER_NAME}__{MCP_ASK_TOOL_NAME}");

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
    // The built-in AskUserQuestion can't work headless (see module doc comment
    // above), so hide it and give Claude an MCP-backed replacement instead.
    claude.push_str(" --disallowedTools AskUserQuestion");
    claude.push_str(&format!(" --allowedTools {}", shell_quote(&mcp_tool_name)));
    claude.push_str(&format!(" --mcp-config {}", shell_quote(&mcp_config)));
    claude.push_str(" --strict-mcp-config");
    claude.push_str(&format!(
        " --append-system-prompt {}",
        shell_quote(&format!(
            "When you need to ask the user a clarifying question, use the {mcp_tool_name} tool \
             (the built-in AskUserQuestion tool is unavailable in this session)."
        ))
    ));

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

    let mcp_answer_tx = Arc::new(Mutex::new(None));
    let mcp_stream = Arc::new(Mutex::new(None));

    // The MCP bridge: accept the Node relay's one connection, then handle its
    // JSON-RPC requests directly (this *is* the MCP server, just over TCP
    // instead of stdio, since the relay is what actually gets spawned by
    // Claude Code). `tools/call` blocks on `mcp_answer_tx` until the frontend
    // delivers an answer via the `answer_mcp_question` command.
    let mcp_answer_tx_for_thread = mcp_answer_tx.clone();
    let mcp_stream_for_thread = mcp_stream.clone();
    std::thread::spawn(move || {
        let Ok((stream, _)) = mcp_listener.accept() else {
            return;
        };
        let Ok(mut writer) = stream.try_clone() else {
            return;
        };
        if let Ok(stream_for_slot) = stream.try_clone() {
            *mcp_stream_for_thread.lock().unwrap() = Some(stream_for_slot);
        }
        let reader = BufReader::new(stream);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(req) = serde_json::from_str::<Value>(trimmed) else {
                continue;
            };
            let method = req.get("method").and_then(Value::as_str).unwrap_or("");
            let id = req.get("id").cloned().unwrap_or(Value::Null);
            let response = match method {
                "initialize" => Some(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": { "tools": {} },
                        "serverInfo": { "name": MCP_ASK_SERVER_NAME, "version": "0.1.0" }
                    }
                })),
                "notifications/initialized" => None,
                "tools/list" => Some(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "tools": [{
                            "name": MCP_ASK_TOOL_NAME,
                            "description": "Ask the user one or more clarifying questions with multiple-choice options and get their answers back.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "questions": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "question": { "type": "string" },
                                                "header": { "type": "string" },
                                                "multiSelect": { "type": "boolean" },
                                                "options": {
                                                    "type": "array",
                                                    "items": {
                                                        "type": "object",
                                                        "properties": {
                                                            "label": { "type": "string" },
                                                            "description": { "type": "string" }
                                                        },
                                                        "required": ["label"]
                                                    }
                                                }
                                            },
                                            "required": ["question", "options"]
                                        }
                                    }
                                },
                                "required": ["questions"]
                            }
                        }]
                    }
                })),
                "tools/call" => {
                    let (tx, rx) = mpsc::channel::<String>();
                    *mcp_answer_tx_for_thread.lock().unwrap() = Some(tx);
                    let answer = rx.recv().unwrap_or_default();
                    Some(json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": { "content": [{ "type": "text", "text": answer }] }
                    }))
                }
                _ => {
                    if id.is_null() {
                        None
                    } else {
                        Some(json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": { "code": -32601, "message": "method not found" }
                        }))
                    }
                }
            };
            if let Some(response) = response {
                if writeln!(writer, "{response}").is_err() {
                    break;
                }
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
                mcp_answer_tx,
                mcp_stream,
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

/// Answer the pending `ask_user_question` MCP tool call (see the module doc
/// comment). Delivers the answer to the listener thread blocked on
/// `mcp_answer_tx`, which writes it as that call's JSON-RPC result — this is
/// how the answer actually reaches Claude, not a synthetic `tool_result`
/// written to the agent's stdin.
#[tauri::command]
pub fn answer_mcp_question(
    manager: tauri::State<'_, ClaudeAgentManager>,
    handle_id: String,
    content: String,
) -> Result<(), String> {
    let handle = agent_handle(&manager, &handle_id)?;
    let handle = handle.lock().map_err(|_| "Claude agent lock poisoned")?;
    let tx = handle
        .mcp_answer_tx
        .lock()
        .map_err(|_| "Claude agent lock poisoned")?
        .take();
    match tx {
        Some(tx) => tx.send(content).map_err(|e| e.to_string()),
        None => Err("no pending question for this agent".into()),
    }
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
            // Unblock the MCP listener thread (if it's mid-`tools/call`) and let
            // the Node bridge see its socket close and exit, rather than leaking
            // both as orphans.
            if let Ok(mut stream) = handle.mcp_stream.lock() {
                if let Some(stream) = stream.take() {
                    let _ = stream.shutdown(std::net::Shutdown::Both);
                }
            }
        }
    }
    Ok(())
}
