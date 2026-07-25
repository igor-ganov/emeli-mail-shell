// Emeli-mail desktop shell.
//
// The OAuth refresh token and other secrets live in the OS keychain via the
// `keyring` crate — never in the WebView or in localStorage. The UI asks the
// shell to store/load them through these IPC commands.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod yahoo;

use keyring::{Entry, Error as KeyringError};

fn entry(service: &str, account: &str) -> Result<Entry, String> {
    Entry::new(service, account).map_err(|e| e.to_string())
}

/// Store a secret in the OS keychain.
#[tauri::command]
fn secure_store(service: String, account: String, secret: String) -> Result<(), String> {
    entry(&service, &account)?
        .set_password(&secret)
        .map_err(|e| e.to_string())
}

/// Load a secret; `None` when nothing is stored for this service/account.
#[tauri::command]
fn secure_load(service: String, account: String) -> Result<Option<String>, String> {
    match entry(&service, &account)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Delete a stored secret (sign-out).
#[tauri::command]
fn secure_delete(service: String, account: String) -> Result<(), String> {
    match entry(&service, &account)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            secure_store,
            secure_load,
            secure_delete,
            yahoo::yahoo_sign_in,
            yahoo::yahoo_account,
            yahoo::yahoo_inbox
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Emeli shell");
}
