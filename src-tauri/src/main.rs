#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

fn to_io_error(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::Other, message.into())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| to_io_error(error.to_string()))?;
            std::fs::create_dir_all(&app_data_dir)?;

            // Matches `bundle.externalBin` entry basename (`binaries/chatplus-backend`).
            let (_rx, _child) = app
                .shell()
                .sidecar("chatplus-backend")
                .map_err(|error| to_io_error(format!("sidecar resolve failed: {error}")))?
                .env("HOST", "127.0.0.1")
                // Keep in sync with repo-root ports.json → desktop.backend
                .env("PORT", "18773")
                .env(
                    "CHATPLUS_DATA_DIR",
                    app_data_dir.to_string_lossy().to_string(),
                )
                .current_dir(&app_data_dir)
                .spawn()
                .map_err(|error| to_io_error(format!("sidecar spawn failed: {error}")))?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
