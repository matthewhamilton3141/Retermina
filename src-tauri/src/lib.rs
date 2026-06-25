mod claude_stats;
mod fonts;
mod fs;
mod iris;
mod presets;
mod localhost;
mod pty;
mod terminal_import;
mod vscode;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyManager::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            vscode::get_recent_workspaces,
            pty::create_pty_session,
            pty::write_to_pty,
            pty::resize_pty,
            pty::close_pty,
            localhost::list_listening_ports,
            localhost::kill_process,
            iris::git_status,
            iris::run_background_command,
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
            terminal_import::get_terminal_cwd,
            claude_stats::get_claude_token_usage,
            claude_stats::set_claude_theme,
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
