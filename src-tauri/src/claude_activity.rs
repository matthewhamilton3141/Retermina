//! Aggregates daily "AI line edit" activity across every Claude Code project
//! for the contribution-style heatmap on Retermina's launch page.
//!
//! Unlike `claude_stats`, which scopes token usage to one workspace, this
//! walks every `~/.claude/projects/*/*.jsonl` file (all workspaces) and sums
//! lines touched by Claude's file-editing tools (`Edit`, `MultiEdit`,
//! `Write`) per calendar day. The day key is read straight off each record's
//! `timestamp` field (`YYYY-MM-DDTHH:MM:SS.sssZ`, UTC) by slicing the first
//! 10 characters — no date library needed.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeActivityDay {
    /// Calendar day, UTC, `YYYY-MM-DD`.
    pub date: String,
    pub lines: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeActivityStats {
    pub days: Vec<ClaudeActivityDay>,
}

fn count_lines(s: &str) -> u64 {
    if s.is_empty() {
        0
    } else {
        s.matches('\n').count() as u64 + 1
    }
}

/// Lines touched by one Edit/MultiEdit/Write tool_use block. Not a true diff
/// — old+new line counts, the same proxy the frontend's
/// `extractClaudeToolDiffs` uses for the equivalent stat elsewhere in the app.
fn lines_for_tool_use(name: &str, input: &Value) -> u64 {
    if let (Some(old), Some(new)) = (
        input.get("old_string").and_then(|v| v.as_str()),
        input.get("new_string").and_then(|v| v.as_str()),
    ) {
        return count_lines(old) + count_lines(new);
    }
    if let Some(edits) = input.get("edits").and_then(|v| v.as_array()) {
        return edits
            .iter()
            .map(|edit| {
                let old = edit.get("old_string").and_then(|v| v.as_str()).unwrap_or("");
                let new = edit.get("new_string").and_then(|v| v.as_str()).unwrap_or("");
                count_lines(old) + count_lines(new)
            })
            .sum();
    }
    if name.eq_ignore_ascii_case("write") {
        if let Some(content) = input.get("content").and_then(|v| v.as_str()) {
            return count_lines(content);
        }
    }
    0
}

fn day_key(timestamp: &str) -> Option<&str> {
    if timestamp.len() >= 10 {
        Some(&timestamp[0..10])
    } else {
        None
    }
}

fn projects_root() -> Option<std::path::PathBuf> {
    let home = dirs::home_dir()?;
    let dir = home.join(".claude").join("projects");
    if dir.is_dir() { Some(dir) } else { None }
}

fn tally_file(path: &std::path::Path, totals: &mut HashMap<String, u64>) {
    let Ok(content) = std::fs::read_to_string(path) else { return };
    for line in content.lines() {
        let Ok(val) = serde_json::from_str::<Value>(line) else { continue };
        if val.get("isSidechain").and_then(|v| v.as_bool()) == Some(true) {
            continue;
        }
        if val.get("type").and_then(|v| v.as_str()) != Some("assistant") {
            continue;
        }
        let Some(timestamp) = val.get("timestamp").and_then(|v| v.as_str()) else { continue };
        let Some(day) = day_key(timestamp) else { continue };
        let Some(blocks) = val
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array())
        else {
            continue;
        };

        for block in blocks {
            if block.get("type").and_then(|v| v.as_str()) != Some("tool_use") {
                continue;
            }
            let name = block.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let empty = Value::Object(Default::default());
            let input = block.get("input").unwrap_or(&empty);
            let lines = lines_for_tool_use(name, input);
            if lines > 0 {
                *totals.entry(day.to_string()).or_insert(0) += lines;
            }
        }
    }
}

/// Tauri command: total lines Claude has edited, per UTC calendar day, across
/// every project it has ever run in on this machine.
#[tauri::command]
pub fn get_claude_activity() -> ClaudeActivityStats {
    let mut totals: HashMap<String, u64> = HashMap::new();

    let Some(root) = projects_root() else {
        return ClaudeActivityStats { days: vec![] };
    };
    let Ok(project_dirs) = std::fs::read_dir(&root) else {
        return ClaudeActivityStats { days: vec![] };
    };

    for project in project_dirs.filter_map(|e| e.ok()) {
        let project_path = project.path();
        if !project_path.is_dir() {
            continue;
        }
        let Ok(files) = std::fs::read_dir(&project_path) else { continue };
        for file in files.filter_map(|e| e.ok()) {
            let path = file.path();
            if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                tally_file(&path, &mut totals);
            }
        }
    }

    let mut days: Vec<ClaudeActivityDay> = totals
        .into_iter()
        .map(|(date, lines)| ClaudeActivityDay { date, lines })
        .collect();
    days.sort_by(|a, b| a.date.cmp(&b.date));

    ClaudeActivityStats { days }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn counts_edit_old_and_new_lines() {
        let input = json!({ "old_string": "a\nb", "new_string": "a\nb\nc\nd" });
        assert_eq!(lines_for_tool_use("Edit", &input), 2 + 4);
    }

    #[test]
    fn counts_multi_edit_across_all_edits() {
        let input = json!({
            "edits": [
                { "old_string": "x", "new_string": "x\ny" },
                { "old_string": "", "new_string": "z" },
            ]
        });
        assert_eq!(lines_for_tool_use("MultiEdit", &input), (1 + 2) + (0 + 1));
    }

    #[test]
    fn counts_write_content_lines() {
        let input = json!({ "content": "one\ntwo\nthree" });
        assert_eq!(lines_for_tool_use("Write", &input), 3);
    }

    #[test]
    fn write_is_case_insensitive_and_ignores_other_tools() {
        let input = json!({ "content": "one\ntwo" });
        assert_eq!(lines_for_tool_use("write", &input), 2);
        assert_eq!(lines_for_tool_use("Bash", &input), 0);
    }

    #[test]
    fn empty_string_counts_as_zero_lines_not_one() {
        let input = json!({ "old_string": "", "new_string": "" });
        assert_eq!(lines_for_tool_use("Edit", &input), 0);
    }

    #[test]
    fn day_key_slices_the_calendar_date() {
        assert_eq!(day_key("2026-07-24T22:15:33.123Z"), Some("2026-07-24"));
        assert_eq!(day_key("bad"), None);
    }

    #[test]
    fn tally_file_skips_sidechains_and_non_assistant_records() {
        use std::io::Write;
        let dir = std::env::temp_dir().join(format!("rt-activity-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("session.jsonl");
        let mut f = std::fs::File::create(&path).unwrap();
        // A real edit — should count.
        writeln!(f, "{}", json!({
            "type": "assistant",
            "timestamp": "2026-07-24T10:00:00.000Z",
            "message": { "content": [
                { "type": "tool_use", "name": "Edit", "input": { "old_string": "a", "new_string": "a\nb" } }
            ] }
        })).unwrap();
        // A sidechain edit — should be skipped.
        writeln!(f, "{}", json!({
            "type": "assistant",
            "isSidechain": true,
            "timestamp": "2026-07-24T10:05:00.000Z",
            "message": { "content": [
                { "type": "tool_use", "name": "Edit", "input": { "old_string": "x", "new_string": "x\ny\nz" } }
            ] }
        })).unwrap();
        // A user record — should be skipped.
        writeln!(f, "{}", json!({
            "type": "user",
            "timestamp": "2026-07-24T10:10:00.000Z",
            "message": { "content": "hello" }
        })).unwrap();

        let mut totals = HashMap::new();
        tally_file(&path, &mut totals);
        std::fs::remove_dir_all(&dir).unwrap();

        assert_eq!(totals.get("2026-07-24"), Some(&3u64));
    }
}
