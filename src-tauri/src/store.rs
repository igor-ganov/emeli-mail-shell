//! Cross-platform secret storage in the app's private data directory.
//!
//! `keyring` has no Android backend, so tokens live in a file under the app's
//! per-app private storage (sandboxed on Android; the user profile on desktop).
//! This keeps one implementation across desktop and mobile.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

fn sanitize(part: &str) -> String {
    part.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}

fn secrets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("secrets");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn secret_path(app: &AppHandle, service: &str, account: &str) -> Result<PathBuf, String> {
    Ok(secrets_dir(app)?.join(format!("{}__{}", sanitize(service), sanitize(account))))
}

pub fn store(app: &AppHandle, service: &str, account: &str, secret: &str) -> Result<(), String> {
    fs::write(secret_path(app, service, account)?, secret).map_err(|e| e.to_string())
}

pub fn load(app: &AppHandle, service: &str, account: &str) -> Result<Option<String>, String> {
    let path = secret_path(app, service, account)?;
    match fs::read_to_string(&path) {
        Ok(value) => Ok(Some(value)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn delete(app: &AppHandle, service: &str, account: &str) -> Result<(), String> {
    let path = secret_path(app, service, account)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
