//! In-app Yahoo sign-in and inbox read.
//!
//! The user clicks "Sign in with Yahoo"; the shell opens a Yahoo login window,
//! intercepts the redirect to `https://localhost:8080?code=…`, exchanges the
//! code (public-client PKCE, no secret) for tokens, and stores the refresh
//! token in the OS keychain. `client_id` is an app-level constant (public by
//! design for a native client) — the user never configures anything.

use std::net::TcpStream;
#[cfg(desktop)]
use std::sync::mpsc::channel;
use std::sync::Arc;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
#[cfg(desktop)]
use tauri::{WebviewUrl, WebviewWindowBuilder};

use crate::store;

/// Redirect for the OAuth flow. We use a Yahoo-approved public mail client's
/// registration (Thunderbird): its client id carries the IMAP `mail-w` scope
/// that Yahoo does NOT grant to self-serve apps, and its custom-scheme redirect
/// is what our app registers to catch.
const MOBILE_REDIRECT: &str = "net.thunderbird://oauth/yahoo";
/// Persisted PKCE state between opening the browser and the deep-link callback
/// (survives an app restart while the user is in the browser).
const PENDING_SERVICE: &str = "emeli-pending";
/// Where the deep-link handler records a sign-in error for the UI to surface.
const ERROR_SERVICE: &str = "emeli-signin-error";

// Public native-client credentials (no secret). Thunderbird's Yahoo-approved
// public client id — the only way a non-partner app gets IMAP `mail-w`, which
// Yahoo's self-serve console does not offer.
const CLIENT_ID: &str = "dj0yJmk9WVZUaWRNUUZSQTBNJmQ9WVdrOVNqbHJUMGhtTkU4bWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PTgz";
const REDIRECT_URI: &str = "net.thunderbird://oauth/yahoo";
const AUTHORIZE_URL: &str = "https://api.login.yahoo.com/oauth2/request_auth";
const TOKEN_URL: &str = "https://api.login.yahoo.com/oauth2/get_token";
const USERINFO_URL: &str = "https://api.login.yahoo.com/openid/v1/userinfo";
const SCOPES: &str = "mail-w openid email";
const IMAP_HOST: &str = "imap.mail.yahoo.com";
const IMAP_PORT: u16 = 993;
const KEYRING_SERVICE: &str = "emeli-mail-yahoo";
const KEYRING_ACTIVE: &str = "emeli-mail-active";

#[derive(Serialize)]
pub struct Account {
    pub email: String,
}

#[derive(Serialize)]
pub struct HeaderJson {
    pub uid: String,
    pub sender: String,
    pub subject: String,
    pub snippet: String,
    pub date: i64,
    pub unread: bool,
    pub flagged: bool,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct UserInfo {
    email: Option<String>,
}

fn b64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce() -> (String, String) {
    let mut raw = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut raw);
    let verifier = b64url(&raw);
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let challenge = b64url(&hasher.finalize());
    (verifier, challenge)
}

fn random_state() -> String {
    let mut raw = [0u8; 16];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut raw);
    b64url(&raw)
}

fn exchange_code(code: &str, verifier: &str, redirect: &str) -> Result<TokenResponse, String> {
    post_token(&[
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect),
        ("client_id", CLIENT_ID),
        ("code_verifier", verifier),
    ])
}

fn refresh_access(refresh_token: &str) -> Result<TokenResponse, String> {
    post_token(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", CLIENT_ID),
    ])
}

fn post_token(form: &[(&str, &str)]) -> Result<TokenResponse, String> {
    let client = reqwest::blocking::Client::new();
    let res = client
        .post(TOKEN_URL)
        .form(form)
        .send()
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("token endpoint {}: {}", res.status(), res.text().unwrap_or_default()));
    }
    res.json::<TokenResponse>().map_err(|e| e.to_string())
}

fn fetch_email(access_token: &str) -> Result<String, String> {
    let client = reqwest::blocking::Client::new();
    let info: UserInfo = client
        .get(USERINFO_URL)
        .bearer_auth(access_token)
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;
    info.email.ok_or_else(|| "userinfo returned no email".to_string())
}

/// Open the Yahoo login window and resolve the authorization code (desktop).
#[cfg(desktop)]
async fn authorize(app: &AppHandle, verifier_challenge: (&str, &str)) -> Result<String, String> {
    let (_verifier, challenge) = verifier_challenge;
    let state = random_state();
    let auth_url = build_authorize_url(challenge, &state, REDIRECT_URI)?
        .parse::<url::Url>()
        .map_err(|e: url::ParseError| e.to_string())?;

    let (tx, rx) = channel::<Result<String, String>>();
    let expected_state = state.clone();
    let window = WebviewWindowBuilder::new(
        app,
        "yahoo-auth",
        WebviewUrl::External(auth_url),
    )
    .title("Sign in with Yahoo")
    .inner_size(520.0, 720.0)
    .on_navigation(move |url| {
        if !url.as_str().starts_with(REDIRECT_URI) {
            return true;
        }
        let code = url.query_pairs().find(|(k, _)| k == "code").map(|(_, v)| v.into_owned());
        let got_state = url.query_pairs().find(|(k, _)| k == "state").map(|(_, v)| v.into_owned());
        let result = match (code, got_state) {
            (Some(c), Some(s)) if s == expected_state => Ok(c),
            _ => Err("missing code or state mismatch".to_string()),
        };
        let _ = tx.send(result);
        false // cancel navigation to the (non-existent) localhost target
    })
    .build()
    .map_err(|e| e.to_string())?;

    let code = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())??;
    let _ = window.close();
    Ok(code)
}

fn build_authorize_url(challenge: &str, state: &str, redirect: &str) -> Result<String, String> {
    url::Url::parse_with_params(
        AUTHORIZE_URL,
        &[
            ("client_id", CLIENT_ID),
            ("redirect_uri", redirect),
            ("response_type", "code"),
            ("scope", SCOPES),
            ("state", state),
            ("code_challenge", challenge),
            ("code_challenge_method", "S256"),
        ],
    )
    .map(|u| u.to_string())
    .map_err(|e| e.to_string())
}

/// `Sign in with Yahoo` (public-client PKCE, no secret).
///
/// Desktop opens a login window, intercepts the redirect and completes inline.
/// Mobile persists the PKCE state, opens the system browser and returns an empty
/// account immediately; `handle_deep_link` completes sign-in when Yahoo returns
/// to `emeli://auth/callback` (surviving an app restart), and the UI polls
/// `yahoo_account` / `yahoo_signin_error`.
#[tauri::command]
pub async fn yahoo_sign_in(app: AppHandle) -> Result<Account, String> {
    #[cfg(mobile)]
    {
        use tauri_plugin_opener::OpenerExt;
        let _ = store::clear_log(&app);
        store::append_log(&app, "sign-in: start (mobile)");
        let (verifier, challenge) = pkce();
        let state = random_state();
        let url = build_authorize_url(&challenge, &state, MOBILE_REDIRECT)?;
        store::store(&app, PENDING_SERVICE, "yahoo", &format!("{}\n{}", verifier, state))?;
        let _ = store::delete(&app, ERROR_SERVICE, "yahoo");
        store::append_log(&app, &format!("sign-in: opening browser (redirect {})", MOBILE_REDIRECT));
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|e| e.to_string())?;
        Ok(Account { email: String::new() })
    }
    #[cfg(desktop)]
    {
        let (verifier, challenge) = pkce();
        let code = authorize(&app, (&verifier, &challenge)).await?;
        let token = exchange_code(&code, &verifier, REDIRECT_URI)?;
        let email = fetch_email(&token.access_token)?;
        let refresh = token
            .refresh_token
            .ok_or_else(|| "no refresh token returned".to_string())?;
        store::store(&app, KEYRING_SERVICE, &email, &refresh)?;
        store::store(&app, KEYRING_ACTIVE, "yahoo", &email)?;
        Ok(Account { email })
    }
}

/// Log a URL without leaking the authorization code.
fn redact(url: &str) -> String {
    match url::Url::parse(url) {
        Ok(u) => {
            let params: Vec<String> = u
                .query_pairs()
                .map(|(k, v)| {
                    if k == "code" {
                        format!("{}=<redacted>", k)
                    } else {
                        format!("{}={}", k, v)
                    }
                })
                .collect();
            format!("{}://{}{}?{}", u.scheme(), u.host_str().unwrap_or(""), u.path(), params.join("&"))
        }
        Err(_) => "<unparseable url>".to_string(),
    }
}

/// Complete a mobile sign-in from the deep-link callback, logging each step.
pub fn handle_deep_link(app: &AppHandle, url: &str) {
    store::append_log(app, &format!("deep-link received: {}", redact(url)));
    if let Err(e) = complete_deep_link(app, url) {
        store::append_log(app, &format!("sign-in ERROR: {}", e));
        let _ = store::store(app, ERROR_SERVICE, "yahoo", &e);
    }
}

fn complete_deep_link(app: &AppHandle, url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|e| e.to_string())?;
    let find = |key: &str| {
        parsed
            .query_pairs()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.into_owned())
    };
    if let Some(err) = find("error") {
        let desc = find("error_description").unwrap_or_default();
        return Err(format!("Yahoo returned '{}' {}", err, desc));
    }
    let code = find("code").ok_or_else(|| "callback had no ?code".to_string())?;
    let state = find("state").ok_or_else(|| "callback had no ?state".to_string())?;
    let pending = store::load(app, PENDING_SERVICE, "yahoo")?
        .ok_or_else(|| "no pending sign-in (lost on restart?)".to_string())?;
    let mut lines = pending.lines();
    let verifier = lines
        .next()
        .ok_or_else(|| "bad pending record".to_string())?
        .to_string();
    let saved_state = lines.next().unwrap_or("").to_string();
    if saved_state != state {
        return Err("state mismatch (possible CSRF)".to_string());
    }
    store::append_log(app, "exchanging code for token…");
    let token = exchange_code(&code, &verifier, MOBILE_REDIRECT)?;
    store::append_log(app, "token OK; fetching user email…");
    let email = fetch_email(&token.access_token)?;
    let refresh = token
        .refresh_token
        .ok_or_else(|| "no refresh token returned".to_string())?;
    store::store(app, KEYRING_SERVICE, &email, &refresh)?;
    store::store(app, KEYRING_ACTIVE, "yahoo", &email)?;
    let _ = store::delete(app, PENDING_SERVICE, "yahoo");
    let _ = store::delete(app, ERROR_SERVICE, "yahoo");
    store::append_log(app, &format!("sign-in COMPLETE for {}", email));
    Ok(())
}

/// The last mobile sign-in error, if any (for the UI to surface).
#[tauri::command]
pub fn yahoo_signin_error(app: AppHandle) -> Result<Option<String>, String> {
    store::load(&app, ERROR_SERVICE, "yahoo")
}

/// The diagnostics log, for the user to share.
#[tauri::command]
pub fn yahoo_log(app: AppHandle) -> Result<String, String> {
    store::read_log(&app)
}

/// The signed-in Yahoo account, if any.
#[tauri::command]
pub fn yahoo_account(app: AppHandle) -> Result<Option<String>, String> {
    store::load(&app, KEYRING_ACTIVE, "yahoo")
}

struct XOAuth2 {
    user: String,
    access_token: String,
}

impl imap::Authenticator for XOAuth2 {
    type Response = String;
    fn process(&self, _challenge: &[u8]) -> Self::Response {
        format!("user={}\x01auth=Bearer {}\x01\x01", self.user, self.access_token)
    }
}

type ImapTls = rustls::StreamOwned<rustls::ClientConnection, TcpStream>;

/// A rustls-backed TLS stream (pure Rust — works on desktop and Android).
fn tls_stream(host: &str, port: u16) -> Result<ImapTls, String> {
    let roots = rustls::RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|e| e.to_string())?
    .with_root_certificates(roots)
    .with_no_client_auth();
    let server_name =
        rustls::pki_types::ServerName::try_from(host.to_string()).map_err(|e| e.to_string())?;
    let conn = rustls::ClientConnection::new(Arc::new(config), server_name)
        .map_err(|e| e.to_string())?;
    let sock = TcpStream::connect((host, port)).map_err(|e| e.to_string())?;
    Ok(rustls::StreamOwned::new(conn, sock))
}

/// Read the latest inbox headers over IMAP with XOAUTH2.
#[tauri::command]
pub fn yahoo_inbox(app: AppHandle, email: String, limit: u32) -> Result<Vec<HeaderJson>, String> {
    store::append_log(&app, &format!("imap: fetching inbox for {}", email));
    let result = yahoo_inbox_inner(&app, &email, limit);
    match &result {
        Ok(v) => store::append_log(&app, &format!("imap: {} messages", v.len())),
        Err(e) => store::append_log(&app, &format!("imap ERROR: {}", e)),
    }
    result
}

fn yahoo_inbox_inner(app: &AppHandle, email: &str, limit: u32) -> Result<Vec<HeaderJson>, String> {
    let refresh = store::load(app, KEYRING_SERVICE, email)?
        .ok_or_else(|| "not signed in".to_string())?;
    let token = refresh_access(&refresh)?;

    let tls = tls_stream(IMAP_HOST, IMAP_PORT)?;
    let mut client = imap::Client::new(tls);
    client.read_greeting().map_err(|e| e.to_string())?;
    let auth = XOAuth2 { user: email.to_string(), access_token: token.access_token };
    let mut session = client
        .authenticate("XOAUTH2", &auth)
        .map_err(|(e, _)| e.to_string())?;

    let mailbox = session.select("INBOX").map_err(|e| e.to_string())?;
    let total = mailbox.exists;
    let from = total.saturating_sub(limit.saturating_sub(1)).max(1);
    let range = format!("{}:{}", from, total);
    let fetches = session
        .fetch(range, "(UID ENVELOPE FLAGS INTERNALDATE)")
        .map_err(|e| e.to_string())?;

    let mut out: Vec<HeaderJson> = Vec::new();
    for fetch in fetches.iter() {
        let envelope = fetch.envelope();
        let subject = envelope
            .and_then(|e| e.subject.as_ref())
            .map(|s| String::from_utf8_lossy(s).to_string())
            .unwrap_or_default();
        let sender = envelope
            .and_then(|e| e.from.as_ref())
            .and_then(|addrs| addrs.first())
            .map(|a| {
                let name = a.name.as_ref().map(|n| String::from_utf8_lossy(n).to_string());
                let mailbox = a.mailbox.as_ref().map(|m| String::from_utf8_lossy(m).to_string());
                let host = a.host.as_ref().map(|h| String::from_utf8_lossy(h).to_string());
                match (name, mailbox, host) {
                    (Some(n), _, _) if !n.is_empty() => n,
                    (_, Some(m), Some(h)) => format!("{}@{}", m, h),
                    (_, Some(m), None) => m,
                    _ => String::new(),
                }
            })
            .unwrap_or_default();
        let flags: Vec<imap::types::Flag> = fetch.flags().to_vec();
        let unread = !flags.iter().any(|f| matches!(f, imap::types::Flag::Seen));
        let flagged = flags.iter().any(|f| matches!(f, imap::types::Flag::Flagged));
        let date = fetch
            .internal_date()
            .map(|d| d.timestamp_millis())
            .unwrap_or(0);
        out.push(HeaderJson {
            uid: fetch.uid.map(|u| u.to_string()).unwrap_or_default(),
            sender,
            subject,
            snippet: String::new(),
            date,
            unread,
            flagged,
        });
    }
    let _ = session.logout();
    out.reverse(); // newest first
    Ok(out)
}
