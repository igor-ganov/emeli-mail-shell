//! In-app Yahoo sign-in and inbox read.
//!
//! The user clicks "Sign in with Yahoo"; the shell opens a Yahoo login window,
//! intercepts the redirect to `https://localhost:8080?code=…`, exchanges the
//! code (public-client PKCE, no secret) for tokens, and stores the refresh
//! token in the OS keychain. `client_id` is an app-level constant (public by
//! design for a native client) — the user never configures anything.

use std::sync::mpsc::channel;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

// Public native-client credentials (no secret).
const CLIENT_ID: &str = "dj0yJmk9R1NjcjlKQloxTGVWJmQ9WVdrOVNEUXdSR3RaZUd3bWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PWNj";
const REDIRECT_URI: &str = "https://localhost:8080";
const AUTHORIZE_URL: &str = "https://api.login.yahoo.com/oauth2/request_auth";
const TOKEN_URL: &str = "https://api.login.yahoo.com/oauth2/get_token";
const USERINFO_URL: &str = "https://api.login.yahoo.com/openid/v1/userinfo";
const SCOPES: &str = "mail-r mail-w openid";
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

fn keyring_entry(service: &str, account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, account).map_err(|e| e.to_string())
}

fn exchange_code(code: &str, verifier: &str) -> Result<TokenResponse, String> {
    post_token(&[
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", REDIRECT_URI),
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

/// Open the Yahoo login window and resolve the authorization code.
async fn authorize(app: &AppHandle, verifier_challenge: (&str, &str)) -> Result<String, String> {
    let (_verifier, challenge) = verifier_challenge;
    let state = random_state();
    let auth_url = url::Url::parse_with_params(
        AUTHORIZE_URL,
        &[
            ("client_id", CLIENT_ID),
            ("redirect_uri", REDIRECT_URI),
            ("response_type", "code"),
            ("scope", SCOPES),
            ("state", state.as_str()),
            ("code_challenge", challenge),
            ("code_challenge_method", "S256"),
        ],
    )
    .map_err(|e| e.to_string())?;

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

/// `Sign in with Yahoo`: full public-client PKCE flow, stores the refresh token.
#[tauri::command]
pub async fn yahoo_sign_in(app: AppHandle) -> Result<Account, String> {
    let (verifier, challenge) = pkce();
    let code = authorize(&app, (&verifier, &challenge)).await?;
    let token = exchange_code(&code, &verifier)?;
    let email = fetch_email(&token.access_token)?;
    let refresh = token
        .refresh_token
        .ok_or_else(|| "no refresh token returned".to_string())?;
    keyring_entry(KEYRING_SERVICE, &email)?
        .set_password(&refresh)
        .map_err(|e| e.to_string())?;
    keyring_entry(KEYRING_ACTIVE, "yahoo")?
        .set_password(&email)
        .map_err(|e| e.to_string())?;
    Ok(Account { email })
}

/// The signed-in Yahoo account, if any.
#[tauri::command]
pub fn yahoo_account() -> Result<Option<String>, String> {
    match keyring_entry(KEYRING_ACTIVE, "yahoo")?.get_password() {
        Ok(email) => Ok(Some(email)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
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

/// Read the latest inbox headers over IMAP with XOAUTH2.
#[tauri::command]
pub fn yahoo_inbox(email: String, limit: u32) -> Result<Vec<HeaderJson>, String> {
    let refresh = keyring_entry(KEYRING_SERVICE, &email)?
        .get_password()
        .map_err(|e| e.to_string())?;
    let token = refresh_access(&refresh)?;

    let tls = native_tls::TlsConnector::builder()
        .build()
        .map_err(|e| e.to_string())?;
    let client = imap::connect((IMAP_HOST, IMAP_PORT), IMAP_HOST, &tls).map_err(|e| e.to_string())?;
    let auth = XOAuth2 { user: email, access_token: token.access_token };
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
