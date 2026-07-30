mod claude_activity;
mod claude_agent;
mod claude_stats;
mod fonts;
mod fs;
mod localhost;
mod presets;
mod pty;
// The live-session host + its wire protocol are unix-only for now (unix-domain
// sockets). `pub` so the `session-host` binary can reach `session_host::run`.
#[cfg(unix)]
pub mod session_host;
#[cfg(unix)]
pub mod session_proto;
mod shell;
mod terminal_import;
mod vscode;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyManager::default())
        .manage(claude_agent::ClaudeAgentManager::default())
        .invoke_handler(tauri::generate_handler![
            vscode::get_recent_workspaces,
            pty::create_pty_session,
            pty::attach_pty_session,
            pty::write_to_pty,
            pty::resize_pty,
            pty::close_pty,
            localhost::list_listening_ports,
            localhost::kill_process,
            shell::git_status,
            shell::run_background_command,
            fs::list_dir,
            fs::read_file,
            fs::write_file,
            fs::create_file,
            fs::create_dir,
            fs::rename_path,
            fs::delete_path,
            fs::suggest_directories,
            fs::validate_directory,
            fs::list_files,
            fs::search_in_files,
            terminal_import::get_terminal_cwd,
            claude_agent::start_claude_agent,
            claude_agent::send_claude_agent,
            claude_agent::answer_mcp_question,
            claude_agent::interrupt_claude_agent,
            claude_agent::stop_claude_agent,
            claude_stats::get_claude_token_usage,
            claude_stats::read_claude_session_transcript,
            claude_stats::set_claude_theme,
            claude_activity::get_claude_activity,
            fonts::save_font,
            fonts::read_font,
            fonts::list_fonts,
            fonts::delete_font,
            presets::read_presets,
            presets::write_presets
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
