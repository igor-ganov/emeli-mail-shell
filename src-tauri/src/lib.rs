// Emeli-mail shell (desktop + Android).
//
// Secrets (OAuth refresh tokens) live in the app's private data directory via
// `store` — one implementation across desktop and mobile, never in the WebView.

mod store;
mod yahoo;

use tauri::AppHandle;

/// Store a secret in the app's private storage.
#[tauri::command]
fn secure_store(app: AppHandle, service: String, account: String, secret: String) -> Result<(), String> {
    store::store(&app, &service, &account, &secret)
}

/// Load a secret; `None` when nothing is stored for this service/account.
#[tauri::command]
fn secure_load(app: AppHandle, service: String, account: String) -> Result<Option<String>, String> {
    store::load(&app, &service, &account)
}

/// Delete a stored secret (sign-out).
#[tauri::command]
fn secure_delete(app: AppHandle, service: String, account: String) -> Result<(), String> {
    store::delete(&app, &service, &account)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            #[cfg(mobile)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        yahoo::handle_deep_link(&handle, url.as_str());
                    }
                });
            }
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            secure_store,
            secure_load,
            secure_delete,
            yahoo::yahoo_sign_in,
            yahoo::yahoo_account,
            yahoo::yahoo_signin_error,
            yahoo::yahoo_log,
            yahoo::yahoo_inbox
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Emeli shell");
}
