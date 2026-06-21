//! Reads Claude Code's local project JSONL history to surface per-project
//! token usage and approximate cost in the Claude Code panel.
//!
//! Claude Code stores conversation history under:
//!   `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`
//!
//! The path encoding replaces every `/` with `-`:
//!   `/Users/x/myproject` → `-Users-x-myproject`
//!
//! Each line in a JSONL file is a JSON object. Assistant messages carry a
//! `message.usage` object with four token counters we aggregate.

use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeTokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    /// Number of distinct sessions (JSONL files) found.
    pub session_count: u32,
    /// Estimated total cost in USD (approximate, based on Sonnet 4 pricing).
    pub estimated_cost_usd: f64,
}

/// Convert an absolute workspace path to the Claude project directory name.
/// `/Users/x/proj` → `-Users-x-proj`
fn cwd_to_project_key(cwd: &str) -> String {
    cwd.replace('/', "-")
}

/// Locate the `.claude/projects/<key>` directory for a given workspace path.
fn project_dir(cwd: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let key = cwd_to_project_key(cwd);
    let dir = home.join(".claude").join("projects").join(key);
    if dir.is_dir() { Some(dir) } else { None }
}

/// Extract the `usage` object from a parsed JSONL line. Handles both
/// `{ "message": { "usage": {...} } }` (assistant turns) and a bare
/// `{ "usage": {...} }` at the top level.
fn extract_usage(val: &Value) -> Option<&Value> {
    val.get("message")
        .and_then(|m| m.get("usage"))
        .or_else(|| val.get("usage"))
}

fn u64_field(obj: &Value, key: &str) -> u64 {
    obj.get(key).and_then(|v| v.as_u64()).unwrap_or(0)
}

/// Sum token usage across all JSONL sessions for `cwd`.
fn read_usage(cwd: &str) -> ClaudeTokenUsage {
    let zero = ClaudeTokenUsage {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        session_count: 0,
        estimated_cost_usd: 0.0,
    };

    let Some(dir) = project_dir(cwd) else { return zero; };

    let Ok(entries) = std::fs::read_dir(&dir) else { return zero; };

    let mut input: u64 = 0;
    let mut output: u64 = 0;
    let mut cache_read: u64 = 0;
    let mut cache_create: u64 = 0;
    let mut sessions: u32 = 0;

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }

        let Ok(content) = std::fs::read_to_string(&path) else { continue };
        sessions += 1;

        for line in content.lines() {
            let Ok(val) = serde_json::from_str::<Value>(line) else { continue };
            let Some(usage) = extract_usage(&val) else { continue };

            input        += u64_field(usage, "input_tokens");
            output       += u64_field(usage, "output_tokens");
            cache_read   += u64_field(usage, "cache_read_input_tokens");
            cache_create += u64_field(usage, "cache_creation_input_tokens");
        }
    }

    // Approximate cost using Claude Sonnet 4 pricing (per 1M tokens):
    //   Input:        $3.00
    //   Output:      $15.00
    //   Cache read:   $0.30
    //   Cache write:  $3.75
    let cost = (input as f64 * 3.00
        + output as f64 * 15.00
        + cache_read as f64 * 0.30
        + cache_create as f64 * 3.75)
        / 1_000_000.0;

    ClaudeTokenUsage {
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: cache_read,
        cache_creation_tokens: cache_create,
        session_count: sessions,
        estimated_cost_usd: (cost * 100.0).round() / 100.0, // round to cents
    }
}

/// Tauri command: return token usage totals for the given workspace directory.
/// Returns zeroed totals (not an error) when no Claude Code history exists.
#[tauri::command]
pub fn get_claude_token_usage(cwd: String) -> ClaudeTokenUsage {
    read_usage(&cwd)
}
