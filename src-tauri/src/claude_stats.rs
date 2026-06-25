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
use std::io::Write;
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

/// Claude Code's six built-in UI theme identifiers. We only ever set the two
/// `*-ansi` variants (so Claude inherits the terminal's 16-colour palette and
/// blends with the active Retermina engine), but the full list guards the
/// command against writing an unknown value.
const CLAUDE_THEMES: [&str; 6] = [
    "light",
    "dark",
    "light-daltonized",
    "dark-daltonized",
    "light-ansi",
    "dark-ansi",
];

/// Tauri command: sync Claude Code's UI theme so the embedded Claude Code panel
/// matches Retermina's active engine. Reads `~/.claude.json`, updates only the
/// `theme` key, and writes it back atomically.
///
/// Claude Code reads this at launch, so the change applies to the next `claude`
/// session rather than a running one. We deliberately:
///   * never CREATE the file (only Claude should bootstrap its own config),
///   * bail out silently if it can't be read/parsed (don't risk clobbering it),
///   * skip the write when the theme is already current (avoid churn), and
///   * write via a temp file + rename so a crash mid-write can't truncate it.
#[tauri::command]
pub fn set_claude_theme(theme: String) -> Result<(), String> {
    if !CLAUDE_THEMES.contains(&theme.as_str()) {
        return Err(format!("unknown claude theme: {theme}"));
    }

    let Some(home) = dirs::home_dir() else {
        return Err("no home directory".into());
    };
    let path = home.join(".claude.json");

    // Claude Code owns this file; only touch it if it already exists.
    let Ok(content) = std::fs::read_to_string(&path) else {
        return Ok(());
    };
    let Ok(mut config) = serde_json::from_str::<Value>(&content) else {
        return Ok(()); // unparseable — leave it untouched
    };
    let Some(obj) = config.as_object_mut() else {
        return Ok(());
    };

    if obj.get("theme").and_then(|v| v.as_str()) == Some(theme.as_str()) {
        return Ok(()); // already in sync
    }
    obj.insert("theme".into(), Value::String(theme));

    let serialized = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;

    let tmp = path.with_extension("json.retermina.tmp");
    {
        let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(serialized.as_bytes()).map_err(|e| e.to_string())?;
        f.flush().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}
