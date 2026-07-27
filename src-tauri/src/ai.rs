// ── AI assistant backend ──────────────────────────────────────────────────
// Talks to any OpenAI-compatible `/chat/completions` endpoint. The provider is
// not hard-coded: the user supplies a base URL, a model name and an API key, so
// OpenAI, OpenRouter, Groq, a local Ollama (`http://localhost:11434/v1`) or a
// company gateway all work through the same path.
//
// The call lives in Rust rather than the webview for one reason: the API key
// stays in the OS keychain and is only ever read into a request header. It is
// never handed to JavaScript, and `settings` deliberately reports whether a key
// exists without ever returning it.
//
// Responses stream. Each chunk is emitted as a Tauri event so the UI can render
// tokens as they arrive instead of waiting for the full completion.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

/// Keychain entry holding the provider API key.
const KEYCHAIN_SERVICE: &str = "com.zeru.sql.ai";
const KEYCHAIN_ACCOUNT: &str = "api-key";
/// Non-secret settings file inside the app config directory.
const SETTINGS_FILE: &str = "ai.json";

/// Event names the frontend listens on.
pub const EVENT_DELTA: &str = "ai:delta";
pub const EVENT_DONE: &str = "ai:done";
pub const EVENT_ERROR: &str = "ai:error";

// ── Settings ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    /// Provider root, e.g. `https://api.openai.com/v1`. The `/chat/completions`
    /// suffix is appended when the request is built.
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    /// Whether a key is stored. Reported to the UI so it can show "configured"
    /// without the secret ever crossing the bridge. Never read from disk.
    #[serde(default, skip_deserializing)]
    pub has_api_key: bool,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".to_string(),
            model: "gpt-4o-mini".to_string(),
            temperature: Some(0.2),
            max_tokens: Some(2048),
            has_api_key: false,
        }
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(SETTINGS_FILE))
}

fn keychain() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())
}

fn stored_key() -> Option<String> {
    keychain()
        .ok()
        .and_then(|e| e.get_password().ok())
        .filter(|k| !k.trim().is_empty())
}

/// Read the saved settings, falling back to defaults. `has_api_key` is derived
/// from the keychain, not from the file.
pub fn load_settings(app: &AppHandle) -> Result<AiSettings, String> {
    let path = settings_path(app)?;
    let mut settings = if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        AiSettings::default()
    };
    settings.has_api_key = stored_key().is_some();
    Ok(settings)
}

/// Persist settings, and the API key when one is supplied. Passing
/// `Some("")` clears the stored key; `None` leaves it untouched.
pub fn save_settings(
    app: &AppHandle,
    settings: AiSettings,
    api_key: Option<String>,
) -> Result<AiSettings, String> {
    let path = settings_path(app)?;
    let raw = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())?;

    if let Some(key) = api_key {
        let entry = keychain()?;
        if key.trim().is_empty() {
            // Clearing an absent key is a no-op, not an error.
            let _ = entry.delete_credential();
        } else {
            entry.set_password(key.trim()).map_err(|e| e.to_string())?;
        }
    }
    load_settings(app)
}

// ── Chat ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    /// "system" | "user" | "assistant"
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DeltaEvent {
    request_id: String,
    text: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DoneEvent {
    request_id: String,
    /// Full text, so a listener that missed deltas can still recover.
    text: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ErrorEvent {
    request_id: String,
    message: String,
}

/// In-flight requests, so the UI can stop a stream it no longer wants.
#[derive(Default)]
pub struct AiRegistry {
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl AiRegistry {
    async fn register(&self, id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.cancels.lock().await.insert(id.to_string(), flag.clone());
        flag
    }

    async fn finish(&self, id: &str) {
        self.cancels.lock().await.remove(id);
    }

    /// Signal a running request to stop. Returns false if it already ended.
    pub async fn cancel(&self, id: &str) -> bool {
        match self.cancels.lock().await.get(id) {
            Some(flag) => {
                flag.store(true, Ordering::Relaxed);
                true
            }
            None => false,
        }
    }
}

/// Stream a completion, emitting `ai:delta` per chunk and `ai:done` at the end.
///
/// Errors are returned *and* emitted as `ai:error`: the caller awaits this
/// future, but the UI is driven purely by events, so it must not have to
/// correlate a rejected promise with the message it belongs to.
pub async fn chat(
    app: &AppHandle,
    registry: &AiRegistry,
    request_id: String,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    let result = chat_inner(app, registry, &request_id, messages).await;
    registry.finish(&request_id).await;
    if let Err(message) = &result {
        let _ = app.emit(
            EVENT_ERROR,
            ErrorEvent {
                request_id: request_id.clone(),
                message: message.clone(),
            },
        );
    }
    result
}

async fn chat_inner(
    app: &AppHandle,
    registry: &AiRegistry,
    request_id: &str,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    let settings = load_settings(app)?;
    let key = stored_key().ok_or_else(|| {
        "Nenhuma chave de API configurada. Abra as configurações da IA e informe uma."
            .to_string()
    })?;
    if messages.is_empty() {
        return Err("Nenhuma mensagem para enviar.".to_string());
    }

    let mut body = json!({
        "model": settings.model,
        "messages": messages,
        "stream": true,
    });
    if let Some(t) = settings.temperature {
        body["temperature"] = json!(t);
    }
    if let Some(m) = settings.max_tokens {
        body["max_tokens"] = json!(m);
    }

    let client = reqwest::Client::builder()
        // No overall timeout: a long completion is not a hung connection.
        // Only reaching the server is time-boxed.
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    // Registered before the request goes out, so a cancel issued while we are
    // still waiting on the provider is not silently dropped.
    let cancel = registry.register(request_id).await;

    let response = client
        .post(endpoint(&settings.base_url))
        .bearer_auth(&key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Falha ao contatar o provedor: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(format!("Provedor respondeu {status}: {}", provider_error(&detail)));
    }
    if cancel.load(Ordering::Relaxed) {
        emit_done(app, request_id, "");
        return Ok(());
    }

    let mut stream = response.bytes_stream();
    // Buffered as bytes, not as text. Decoding each chunk on arrival would
    // corrupt any multi-byte character the provider happens to split across a
    // chunk boundary — which is every accented letter in a Portuguese reply.
    // Frames are only decoded once complete, where the UTF-8 is whole.
    let mut buffer: Vec<u8> = Vec::new();
    let mut full = String::new();

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let bytes = chunk.map_err(|e| format!("Conexão interrompida: {e}"))?;
        buffer.extend_from_slice(&bytes);

        // SSE frames are separated by a blank line; a chunk may cut one in half,
        // so only whole frames are consumed and the remainder stays buffered.
        while let Some(cut) = find_separator(&buffer) {
            let frame = String::from_utf8_lossy(&buffer[..cut]).into_owned();
            buffer.drain(..cut + 2);
            match parse_frame(&frame) {
                Frame::Done => {
                    emit_done(app, request_id, &full);
                    return Ok(());
                }
                Frame::Text(text) if !text.is_empty() => {
                    full.push_str(&text);
                    let _ = app.emit(
                        EVENT_DELTA,
                        DeltaEvent {
                            request_id: request_id.to_string(),
                            text,
                        },
                    );
                }
                _ => {}
            }
        }
    }

    emit_done(app, request_id, &full);
    Ok(())
}

fn emit_done(app: &AppHandle, request_id: &str, text: &str) {
    let _ = app.emit(
        EVENT_DONE,
        DoneEvent {
            request_id: request_id.to_string(),
            text: text.to_string(),
        },
    );
}

/// Join the configured base URL with the chat path, tolerating a trailing
/// slash and a base that already ends in `/chat/completions`.
fn endpoint(base_url: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    if base.ends_with("/chat/completions") {
        base.to_string()
    } else {
        format!("{base}/chat/completions")
    }
}

/// Byte offset of the next `\n\n` frame separator, if the buffer holds one.
fn find_separator(buffer: &[u8]) -> Option<usize> {
    buffer.windows(2).position(|w| w == b"\n\n")
}

enum Frame {
    Text(String),
    Done,
    Other,
}

/// Pull the assistant text out of one SSE frame.
///
/// Providers differ in shape: OpenAI-style sends `choices[0].delta.content`,
/// while some gateways echo a non-streaming `choices[0].message.content`. Both
/// are accepted; anything else is ignored rather than treated as an error,
/// since keep-alive comments and role-only frames are normal.
fn parse_frame(frame: &str) -> Frame {
    for line in frame.lines() {
        let line = line.trim();
        let Some(payload) = line.strip_prefix("data:") else {
            continue;
        };
        let payload = payload.trim();
        if payload == "[DONE]" {
            return Frame::Done;
        }
        let Ok(json) = serde_json::from_str::<Json>(payload) else {
            continue;
        };
        let choice = &json["choices"][0];
        let text = choice["delta"]["content"]
            .as_str()
            .or_else(|| choice["message"]["content"].as_str());
        if let Some(text) = text {
            return Frame::Text(text.to_string());
        }
    }
    Frame::Other
}

/// Providers return errors as JSON; surface the human-readable message rather
/// than dumping the envelope on the user.
fn provider_error(body: &str) -> String {
    serde_json::from_str::<Json>(body)
        .ok()
        .and_then(|v| {
            v["error"]["message"]
                .as_str()
                .or_else(|| v["message"].as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| {
            let trimmed = body.trim();
            if trimmed.is_empty() {
                "sem detalhes".to_string()
            } else {
                trimmed.chars().take(300).collect()
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_appends_path_once() {
        assert_eq!(
            endpoint("https://api.openai.com/v1"),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            endpoint("https://api.openai.com/v1/"),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            endpoint("  https://api.openai.com/v1/chat/completions  "),
            "https://api.openai.com/v1/chat/completions"
        );
    }

    #[test]
    fn parses_openai_delta_frames() {
        let frame = r#"data: {"choices":[{"delta":{"content":"SELECT"}}]}"#;
        match parse_frame(frame) {
            Frame::Text(t) => assert_eq!(t, "SELECT"),
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn parses_non_streaming_message_shape() {
        let frame = r#"data: {"choices":[{"message":{"content":"oi"}}]}"#;
        match parse_frame(frame) {
            Frame::Text(t) => assert_eq!(t, "oi"),
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn recognises_done_and_ignores_noise() {
        assert!(matches!(parse_frame("data: [DONE]"), Frame::Done));
        assert!(matches!(parse_frame(": keep-alive"), Frame::Other));
        assert!(matches!(
            parse_frame(r#"data: {"choices":[{"delta":{"role":"assistant"}}]}"#),
            Frame::Other
        ));
        assert!(matches!(parse_frame("data: not json"), Frame::Other));
    }

    #[test]
    fn extracts_provider_error_message() {
        assert_eq!(
            provider_error(r#"{"error":{"message":"Invalid API key"}}"#),
            "Invalid API key"
        );
        assert_eq!(provider_error(""), "sem detalhes");
        assert_eq!(provider_error("boom"), "boom");
    }

    #[test]
    fn finds_frame_separator_by_bytes() {
        assert_eq!(find_separator(b"data: 1\n\ndata: 2"), Some(7));
        assert_eq!(find_separator(b"data: 1\n"), None);
        assert_eq!(find_separator(b""), None);
    }

    /// A provider may split a multi-byte character across two chunks. Decoding
    /// per chunk would emit replacement characters; buffering bytes and
    /// decoding whole frames keeps the text intact.
    #[test]
    fn multibyte_split_across_chunks_survives() {
        let payload = r#"data: {"choices":[{"delta":{"content":"ação"}}]}"#;
        let bytes = format!("{payload}\n\n").into_bytes();

        // Cut in the middle of the two-byte "ç".
        let split = bytes
            .iter()
            .position(|b| *b == 0xC3)
            .expect("payload contains a multi-byte character")
            + 1;

        let mut buffer: Vec<u8> = Vec::new();
        buffer.extend_from_slice(&bytes[..split]);
        assert!(find_separator(&buffer).is_none(), "frame is still partial");
        buffer.extend_from_slice(&bytes[split..]);

        let cut = find_separator(&buffer).expect("frame is now complete");
        let frame = String::from_utf8_lossy(&buffer[..cut]).into_owned();
        match parse_frame(&frame) {
            Frame::Text(t) => assert_eq!(t, "ação"),
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn settings_never_deserialise_a_key_flag_from_disk() {
        // `hasApiKey` in the file must not be trusted — it is derived.
        let s: AiSettings =
            serde_json::from_str(r#"{"baseUrl":"x","model":"m","hasApiKey":true}"#).unwrap();
        assert!(!s.has_api_key);
    }
}
