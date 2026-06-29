//! Backend for the Iris command bar.
//!
//! Two capabilities live here:
//! - [`git_status`] inspects the workspace repo so Iris can offer *contextual*
//!   Git macros (e.g. only suggest "Push" when the branch is ahead). It shells
//!   out to `git status --porcelain=v2 --branch`, whose stable machine format is
//!   parsed by the pure, unit-tested [`parse_git_status`].
//! - [`run_background_command`] runs a one-shot command through the user's shell
//!   and captures its output, powering Iris's background execution (used when no
//!   live terminal is available to receive the command).
//!
//! Both run the command through a login shell so a GUI-launched app inherits the
//! user's full `PATH` (where `git`, `node`, etc. actually live).

use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;

/// Summary of the workspace Git repository used to gate contextual macros.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    /// Whether `cwd` is inside a Git work tree at all.
    pub is_repo: bool,
    /// Current branch name; `None` when detached or unknown.
    pub branch: Option<String>,
    /// Short HEAD commit hash (7 chars); `None` before the first commit.
    pub commit: Option<String>,
    /// Whether the branch has a configured upstream (affects push vs publish).
    pub has_upstream: bool,
    /// Commits ahead of upstream.
    pub ahead: u32,
    /// Commits behind upstream.
    pub behind: u32,
    /// Files with staged (index) changes.
    pub staged: u32,
    /// Files with unstaged (work tree) changes.
    pub unstaged: u32,
    /// Untracked files.
    pub untracked: u32,
    /// Unmerged (conflicted) paths.
    pub conflicts: u32,
    /// True when there is nothing to commit and no untracked files.
    pub clean: bool,
}

/// Captured result of a one-shot background command.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    /// Process exit code, or `None` if terminated by a signal.
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// Resolve an optional working directory: keep directories, map a file to its
/// parent, and drop anything that doesn't exist (command then runs in the
/// app's default directory).
fn resolve_dir(cwd: Option<String>) -> Option<PathBuf> {
    let path = PathBuf::from(cwd?);
    if path.is_dir() {
        Some(path)
    } else if path.is_file() {
        path.parent().map(|p| p.to_path_buf())
    } else {
        None
    }
}

/// Build a command that runs `script` through the user's login shell so the
/// full interactive `PATH` is available.
fn shell_command(script: &str) -> Command {
    #[cfg(windows)]
    {
        let mut c = Command::new("powershell.exe");
        c.args(["-NoProfile", "-NonInteractive", "-Command", script]);
        c
    }

    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        let mut c = Command::new(shell);
        // `-l` (login) loads the user's profile so PATH matches their terminal;
        // `-c` runs the script string.
        c.arg("-lc").arg(script);
        c
    }
}

/// Parse `git status --porcelain=v2 --branch` output into a [`GitStatus`].
/// Assumes the caller already confirmed the command succeeded (so this is a
/// repo); `is_repo` is therefore set to `true`.
///
/// Relevant lines (porcelain v2):
/// - `# branch.oid <sha>` — HEAD commit (`(initial)` before the first commit)
/// - `# branch.head <name>` — current branch (`(detached)` when headless)
/// - `# branch.upstream <name>` — present only when an upstream is set
/// - `# branch.ab +<ahead> -<behind>` — divergence from upstream
/// - `1 <XY> ...` / `2 <XY> ...` — changed/renamed entry; `X`=staged, `Y`=unstaged
/// - `u ...` — unmerged (conflict)
/// - `? ...` — untracked
fn parse_git_status(output: &str) -> GitStatus {
    let mut status = GitStatus {
        is_repo: true,
        ..GitStatus::default()
    };

    for line in output.lines() {
        if let Some(oid) = line.strip_prefix("# branch.oid ") {
            let oid = oid.trim();
            // `(initial)` appears before the first commit exists.
            status.commit = if oid == "(initial)" {
                None
            } else {
                Some(oid.chars().take(7).collect())
            };
        } else if let Some(name) = line.strip_prefix("# branch.head ") {
            let name = name.trim();
            status.branch = if name == "(detached)" {
                None
            } else {
                Some(name.to_string())
            };
        } else if line.starts_with("# branch.upstream ") {
            status.has_upstream = true;
        } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
            for token in ab.split_whitespace() {
                if let Some(ahead) = token.strip_prefix('+') {
                    status.ahead = ahead.parse().unwrap_or(0);
                } else if let Some(behind) = token.strip_prefix('-') {
                    status.behind = behind.parse().unwrap_or(0);
                }
            }
        } else if line.starts_with("1 ") || line.starts_with("2 ") {
            // The XY status field is the second whitespace-separated token.
            if let Some(xy) = line.split_whitespace().nth(1) {
                let mut chars = xy.chars();
                if chars.next().is_some_and(|c| c != '.') {
                    status.staged += 1;
                }
                if chars.next().is_some_and(|c| c != '.') {
                    status.unstaged += 1;
                }
            }
        } else if line.starts_with("u ") {
            status.conflicts += 1;
        } else if line.starts_with("? ") {
            status.untracked += 1;
        }
    }

    status.clean =
        status.staged == 0 && status.unstaged == 0 && status.untracked == 0 && status.conflicts == 0;
    status
}

/// Inspect the Git repository at `cwd` for Iris's contextual macros.
///
/// Returns a default ([`GitStatus::is_repo`] == `false`) when `git` is missing
/// or the directory isn't a repo, so the frontend can treat "no repo" uniformly.
#[tauri::command]
pub fn git_status(cwd: Option<String>) -> Result<GitStatus, String> {
    let mut command = shell_command("git status --porcelain=v2 --branch");
    if let Some(dir) = resolve_dir(cwd) {
        command.current_dir(dir);
    }

    let output = match command.output() {
        Ok(output) => output,
        // git not installed / not runnable: behave as "not a repo".
        Err(_) => return Ok(GitStatus::default()),
    };

    if !output.status.success() {
        return Ok(GitStatus::default());
    }

    Ok(parse_git_status(&String::from_utf8_lossy(&output.stdout)))
}

/// Run a one-shot command in the background and capture its output. Used by Iris
/// when there is no live terminal to receive the command directly.
#[tauri::command]
pub fn run_background_command(
    command: String,
    cwd: Option<String>,
) -> Result<CommandResult, String> {
    let script = command.trim();
    if script.is_empty() {
        return Err("empty command".to_string());
    }

    let mut cmd = shell_command(script);
    if let Some(dir) = resolve_dir(cwd) {
        cmd.current_dir(dir);
    }

    let output = cmd.output().map_err(|e| e.to_string())?;
    Ok(CommandResult {
        code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_ahead_behind_and_changes() {
        let output = "\
# branch.oid abc123
# branch.head feature/iris
# branch.upstream origin/feature/iris
# branch.ab +2 -1
1 M. N... 100644 100644 100644 aaa bbb staged.rs
1 .M N... 100644 100644 100644 ccc ddd unstaged.rs
1 MM N... 100644 100644 100644 eee fff both.rs
? untracked.txt
";
        let status = parse_git_status(output);
        assert!(status.is_repo);
        assert_eq!(status.branch.as_deref(), Some("feature/iris"));
        assert_eq!(status.commit.as_deref(), Some("abc123"));
        assert!(status.has_upstream);
        assert_eq!(status.ahead, 2);
        assert_eq!(status.behind, 1);
        // staged.rs (M.) + both.rs (MM) => 2 staged; unstaged.rs (.M) + both.rs => 2 unstaged.
        assert_eq!(status.staged, 2);
        assert_eq!(status.unstaged, 2);
        assert_eq!(status.untracked, 1);
        assert_eq!(status.conflicts, 0);
        assert!(!status.clean);
    }

    #[test]
    fn detects_clean_repo_without_upstream() {
        let output = "\
# branch.oid abc123
# branch.head main
";
        let status = parse_git_status(output);
        assert!(status.is_repo);
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert!(!status.has_upstream);
        assert_eq!(status.ahead, 0);
        assert_eq!(status.behind, 0);
        assert!(status.clean);
    }

    #[test]
    fn counts_conflicts_and_handles_detached_head() {
        let output = "\
# branch.head (detached)
u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.rs
";
        let status = parse_git_status(output);
        assert!(status.branch.is_none());
        assert_eq!(status.conflicts, 1);
        assert!(!status.clean);
    }

    #[test]
    fn truncates_commit_to_seven_chars_and_handles_initial() {
        let full = parse_git_status("# branch.oid 0123456789abcdef\n# branch.head main\n");
        assert_eq!(full.commit.as_deref(), Some("0123456"));

        let initial = parse_git_status("# branch.oid (initial)\n# branch.head main\n");
        assert_eq!(initial.commit, None);
    }

    #[test]
    fn default_status_is_not_a_repo() {
        assert!(!GitStatus::default().is_repo);
    }
}
