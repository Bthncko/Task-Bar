//! Spotify Web API: müzik panelindeki "Sıradakiler" ve listeden şarkıya geçiş
//! (Aşama 7 sonrası, kullanıcı isteği).
//!
//! Doğrulananlar (developer.spotify.com, 2026-11):
//! - Kimlik: Authorization Code + PKCE; istemci sırrı yok. `code_challenge_method`
//!   yalnızca S256. Yönlendirme adresi `localhost` olamaz, loopback IP olmalı
//!   (`http://127.0.0.1:PORT/...`); panelde birebir kayıtlı olmalı.
//! - `GET /v1/me/player/queue` (user-read-playback-state + user-read-currently-playing):
//!   `currently_playing` + `queue` (parça ya da bölüm).
//! - `POST /v1/me/player/next` (user-modify-playback-state): oynatma komutları
//!   Premium ister (403 PREMIUM_REQUIRED). Kuyruktaki bir öğeye doğrudan atlayan
//!   uç nokta yok → o öğeye kadar `next`.
//! - Geliştirme modu: uygulama sahibi Premium olmalı, en çok 5 kullanıcı.
//!
//! Gizlilik: erişim/yenileme anahtarları ve yetki kodu günlüğe yazılmaz.
//! Yenileme anahtarı diskte DPAPI ile (yalnızca bu Windows kullanıcısı açabilir).
//! Ek bağımlılık yok: HTTP WinRT `HttpClient`, SHA-256 / rastgele BCrypt.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use std::{fs, thread};

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use windows::Foundation::Uri;
use windows::Storage::Streams::UnicodeEncoding;
use windows::Web::Http::Filters::{
    HttpBaseProtocolFilter, HttpCacheReadBehavior, HttpCacheWriteBehavior,
};
use windows::Web::Http::{HttpClient, HttpMethod, HttpRequestMessage, HttpStringContent};
use windows::Win32::Foundation::{HLOCAL, LocalFree};
use windows::Win32::Security::Cryptography::{
    BCRYPT_SHA256_ALG_HANDLE, BCRYPT_USE_SYSTEM_PREFERRED_RNG, BCryptGenRandom, BCryptHash,
    CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
};
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};
use windows::core::{HSTRING, w};

use crate::error::{AppError, AppResult};
use crate::services::launcher;

pub const SPOTIFY_CHANGED: &str = "spotify://changed";
const PORT: u16 = 43821;
pub const REDIRECT_URI: &str = "http://127.0.0.1:43821/callback";
const SCOPES: &str =
    "user-read-playback-state user-read-currently-playing user-modify-playback-state";
const AUTHORIZE_URL: &str = "https://accounts.spotify.com/authorize";
const TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
const API: &str = "https://api.spotify.com/v1";
/// Tarayıcıda onay için tanınan süre.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(180);
/// Erişim anahtarını süresi dolmadan bu kadar önce yenile.
const EXPIRY_MARGIN: Duration = Duration::from_secs(60);
/// Art arda "sonraki" komutları arasında: Spotify sırayı karıştırmasın.
const SKIP_GAP: Duration = Duration::from_millis(150);
/// API kuyruğu en çok 20 öğe döndürür.
const MAX_SKIP: u32 = 20;

/// `spotify.json` (config.json'un yanında).
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Stored {
    client_id: String,
    /// DPAPI ile şifrelenmiş yenileme anahtarı (base64).
    refresh_token: Option<String>,
    account: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyStatus {
    pub client_id: String,
    pub connected: bool,
    /// Bağlı hesabın görünen adı.
    pub account: Option<String>,
    pub redirect_uri: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub uri: String,
    pub title: String,
    pub artist: String,
    pub image: Option<String>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Queue {
    pub current: Option<QueueItem>,
    pub items: Vec<QueueItem>,
}

struct Inner {
    stored: Stored,
    /// Bellekteki yenileme anahtarı (çözülmüş).
    refresh: Option<String>,
    access: Option<(String, Instant)>,
}

pub struct Spotify {
    path: PathBuf,
    inner: Mutex<Inner>,
    logging_in: AtomicBool,
}

impl Spotify {
    pub fn load(dir: PathBuf) -> Self {
        let path = dir.join("spotify.json");
        let stored: Stored = fs::read_to_string(&path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        let refresh = stored.refresh_token.as_deref().and_then(|b| {
            let token = unprotect(b);
            if token.is_none() {
                log("kayıtlı anahtar çözülemedi; yeniden bağlanmak gerekecek");
            }
            token
        });
        Self {
            path,
            inner: Mutex::new(Inner {
                stored,
                refresh,
                access: None,
            }),
            logging_in: AtomicBool::new(false),
        }
    }

    pub fn status(&self) -> SpotifyStatus {
        let inner = self.inner.lock().unwrap();
        SpotifyStatus {
            client_id: inner.stored.client_id.clone(),
            connected: inner.refresh.is_some(),
            account: inner.stored.account.clone(),
            redirect_uri: REDIRECT_URI,
        }
    }

    /// Tarayıcıda onay ister, geri dönüşü bekler, anahtarları saklar.
    /// Bekleyen bir iş parçacığında çağrılmalı (en çok 3 dakika sürer).
    pub fn connect(&self, app: &AppHandle, client_id: &str) -> AppResult<SpotifyStatus> {
        let client_id = client_id.trim().to_string();
        if client_id.len() != 32 || !client_id.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(AppError::InvalidInput(
                "Client ID 32 karakterlik bir kod olmalı (Spotify panelindeki uygulama sayfasından)."
                    .into(),
            ));
        }
        if self.logging_in.swap(true, Ordering::SeqCst) {
            return Err(AppError::InvalidInput(
                "Giriş zaten sürüyor; tarayıcıdaki Spotify sayfasını tamamla.".into(),
            ));
        }
        let result = self.login(&client_id);
        self.logging_in.store(false, Ordering::SeqCst);
        let (refresh, access, expires_in) = result?;

        {
            let mut inner = self.inner.lock().unwrap();
            inner.stored.client_id = client_id;
            inner.refresh = Some(refresh);
            inner.access = Some((access, expires_at(expires_in)));
            inner.stored.account = None;
        }
        // Hesap adı yalnızca gösterim için; alınamazsa bağlantı yine geçerli.
        match self.call("GET", "/me") {
            Ok(body) => {
                let me: Value = serde_json::from_str(&body).unwrap_or_default();
                let name = me["display_name"]
                    .as_str()
                    .or(me["id"].as_str())
                    .map(str::to_string);
                self.inner.lock().unwrap().stored.account = name;
            }
            Err(e) => log(&format!("hesap adı alınamadı: {e}")),
        }
        self.save()?;
        log("bağlandı");
        let status = self.status();
        let _ = app.emit(SPOTIFY_CHANGED, &status);
        Ok(status)
    }

    pub fn disconnect(&self, app: &AppHandle) -> AppResult<SpotifyStatus> {
        {
            let mut inner = self.inner.lock().unwrap();
            inner.refresh = None;
            inner.access = None;
            inner.stored.account = None;
        }
        self.save()?;
        log("bağlantı kesildi");
        let status = self.status();
        let _ = app.emit(SPOTIFY_CHANGED, &status);
        Ok(status)
    }

    pub fn queue(&self, app: &AppHandle) -> AppResult<Queue> {
        let body = self.call_checked(app, "GET", "/me/player/queue")?;
        // Çalan bir şey yoksa gövde boş olabilir.
        let json: Value = serde_json::from_str(&body).unwrap_or_default();
        let current = parse_item(&json["currently_playing"]);
        let items = json["queue"]
            .as_array()
            .map(|a| a.iter().filter_map(parse_item).collect())
            .unwrap_or_default();
        Ok(Queue { current, items })
    }

    /// Kuyruktaki `count`. öğeye geç (1 = sıradaki).
    pub fn skip(&self, app: &AppHandle, count: u32) -> AppResult<()> {
        let count = count.clamp(1, MAX_SKIP);
        for i in 0..count {
            if i > 0 {
                thread::sleep(SKIP_GAP);
            }
            self.call_checked(app, "POST", "/me/player/next")?;
        }
        Ok(())
    }

    // --- iç ---------------------------------------------------------------------

    fn save(&self) -> AppResult<()> {
        let stored = {
            let mut inner = self.inner.lock().unwrap();
            inner.stored.refresh_token = inner.refresh.as_deref().and_then(protect);
            inner.stored.clone()
        };
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_string_pretty(&stored)?)?;
        fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    /// Yetki kesildiyse bağlantıyı düşürür, ayarlara haber verir.
    fn call_checked(&self, app: &AppHandle, method: &str, path: &str) -> AppResult<String> {
        self.call(method, path).inspect_err(|e| {
            if matches!(e, AppError::InvalidInput(m) if m == EXPIRED)
                && self.inner.lock().unwrap().refresh.is_none()
            {
                let _ = self.save();
                let _ = app.emit(SPOTIFY_CHANGED, &self.status());
            }
        })
    }

    /// Yetkili API çağrısı; 401'de anahtarı bir kez yenileyip tekrar dener.
    fn call(&self, method: &str, path: &str) -> AppResult<String> {
        let url = format!("{API}{path}");
        let mut retried = false;
        loop {
            let token = self.access_token(retried)?;
            let res = http(method, &url, Some(&token), None)?;
            match res.status {
                200..=299 => return Ok(res.body),
                401 if !retried => retried = true,
                status => return Err(api_error(status, &res.body)),
            }
        }
    }

    fn access_token(&self, force: bool) -> AppResult<String> {
        let mut inner = self.inner.lock().unwrap();
        if !force
            && let Some((token, until)) = &inner.access
            && Instant::now() < *until
        {
            return Ok(token.clone());
        }
        let Some(refresh) = inner.refresh.clone() else {
            return Err(AppError::InvalidInput(NOT_CONNECTED.into()));
        };
        let body = form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", &refresh),
            ("client_id", &inner.stored.client_id),
        ]);
        let res = http("POST", TOKEN_URL, None, Some(&body))?;
        let json: Value = serde_json::from_str(&res.body).unwrap_or_default();
        if res.status == 400 && json["error"] == "invalid_grant" {
            // İzin kaldırıldı ya da anahtar geçersiz: yeniden bağlanmak gerek.
            log("yenileme anahtarı geçersiz; bağlantı düştü");
            inner.refresh = None;
            inner.access = None;
            return Err(AppError::InvalidInput(EXPIRED.into()));
        }
        if !(200..300).contains(&res.status) {
            log(&format!("anahtar yenilenemedi: HTTP {}", res.status));
            return Err(AppError::InvalidInput(format!(
                "Spotify'a ulaşılamadı (HTTP {}).",
                res.status
            )));
        }
        let access = json["access_token"]
            .as_str()
            .ok_or_else(|| AppError::InvalidInput("Spotify yanıtı anlaşılamadı.".into()))?
            .to_string();
        let expires = expires_at(json["expires_in"].as_u64().unwrap_or(3600));
        inner.access = Some((access.clone(), expires));
        // Spotify yeni yenileme anahtarı verebilir: eskisi geçersizleşir, diske de yaz.
        if let Some(new) = json["refresh_token"].as_str()
            && new != refresh
        {
            inner.refresh = Some(new.to_string());
            drop(inner);
            let _ = self.save();
        }
        Ok(access)
    }

    /// PKCE girişi: (yenileme anahtarı, erişim anahtarı, süre sn).
    fn login(&self, client_id: &str) -> AppResult<(String, String, u64)> {
        let listener = TcpListener::bind(("127.0.0.1", PORT)).map_err(|e| {
            AppError::InvalidInput(format!(
                "127.0.0.1:{PORT} dinlenemedi ({e}). Başka bir program bu portu kullanıyor olabilir."
            ))
        })?;
        listener.set_nonblocking(true)?;

        let verifier = URL_SAFE_NO_PAD.encode(random::<64>()?);
        let challenge = URL_SAFE_NO_PAD.encode(sha256(verifier.as_bytes())?);
        let state = URL_SAFE_NO_PAD.encode(random::<16>()?);
        let url = format!(
            "{AUTHORIZE_URL}?{}",
            form(&[
                ("client_id", client_id),
                ("response_type", "code"),
                ("redirect_uri", REDIRECT_URI),
                ("code_challenge_method", "S256"),
                ("code_challenge", &challenge),
                ("state", &state),
                ("scope", SCOPES),
            ])
        );
        launcher::open_uri(&url)
            .map_err(|_| AppError::InvalidInput("Tarayıcı açılamadı.".into()))?;

        let deadline = Instant::now() + LOGIN_TIMEOUT;
        let params = loop {
            match listener.accept() {
                Ok((stream, _)) => {
                    if let Some(params) = handle_callback(stream) {
                        break params;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if Instant::now() > deadline {
                        return Err(AppError::InvalidInput(
                            "Spotify onayı 3 dakika içinde gelmedi; yeniden dene.".into(),
                        ));
                    }
                    thread::sleep(Duration::from_millis(100));
                }
                Err(e) => return Err(e.into()),
            }
        };
        drop(listener);

        let get = |k: &str| params.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str());
        if get("state") != Some(state.as_str()) {
            return Err(AppError::InvalidInput(
                "Spotify yanıtı bu girişe ait değil.".into(),
            ));
        }
        if let Some(error) = get("error") {
            return Err(AppError::InvalidInput(if error == "access_denied" {
                "Spotify'da izin verilmedi.".into()
            } else {
                format!("Spotify girişi başarısız: {error}")
            }));
        }
        let code =
            get("code").ok_or_else(|| AppError::InvalidInput("Spotify kod vermedi.".into()))?;

        let body = form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", REDIRECT_URI),
            ("client_id", client_id),
            ("code_verifier", &verifier),
        ]);
        let res = http("POST", TOKEN_URL, None, Some(&body))?;
        let json: Value = serde_json::from_str(&res.body).unwrap_or_default();
        if !(200..300).contains(&res.status) {
            let detail = json["error_description"]
                .as_str()
                .or(json["error"].as_str())
                .unwrap_or("bilinmeyen hata");
            return Err(AppError::InvalidInput(format!(
                "Spotify anahtar vermedi: {detail}. Panelde yönlendirme adresinin {REDIRECT_URI} olduğunu kontrol et."
            )));
        }
        let refresh = json["refresh_token"].as_str();
        let access = json["access_token"].as_str();
        match (refresh, access) {
            (Some(r), Some(a)) => Ok((
                r.to_string(),
                a.to_string(),
                json["expires_in"].as_u64().unwrap_or(3600),
            )),
            _ => Err(AppError::InvalidInput(
                "Spotify yanıtı anlaşılamadı.".into(),
            )),
        }
    }
}

const NOT_CONNECTED: &str = "Spotify bağlı değil.";
const EXPIRED: &str = "Spotify bağlantısı sona erdi; Ayarlar → Müzik'ten yeniden bağlan.";

fn expires_at(secs: u64) -> Instant {
    Instant::now() + Duration::from_secs(secs).saturating_sub(EXPIRY_MARGIN)
}

fn api_error(status: u16, body: &str) -> AppError {
    let json: Value = serde_json::from_str(body).unwrap_or_default();
    let reason = json["error"]["reason"].as_str().unwrap_or("");
    let message = match (status, reason) {
        (_, "PREMIUM_REQUIRED") => "Bu işlem Spotify Premium ister.".to_string(),
        (_, "NO_ACTIVE_DEVICE") | (404, _) => "Spotify'da etkin bir cihaz yok.".to_string(),
        (403, _) => "Spotify bu işleme izin vermedi.".to_string(),
        (429, _) => "Spotify çok fazla istek aldı; biraz sonra yeniden dene.".to_string(),
        _ => format!("Spotify hatası (HTTP {status})."),
    };
    log(&format!("API hatası: HTTP {status} {reason}"));
    AppError::InvalidInput(message)
}

fn parse_item(v: &Value) -> Option<QueueItem> {
    let title = v["name"].as_str()?.to_string();
    let uri = v["uri"].as_str().unwrap_or_default().to_string();
    let (artist, images) = if v["type"] == "episode" {
        (
            v["show"]["name"].as_str().unwrap_or_default().to_string(),
            &v["images"],
        )
    } else {
        let artists = v["artists"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|x| x["name"].as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();
        (artists, &v["album"]["images"])
    };
    Some(QueueItem {
        uri,
        title,
        artist,
        image: pick_image(images),
        duration_ms: v["duration_ms"].as_u64().unwrap_or(0),
    })
}

/// Liste için yeterli en küçük kapak (genelde 64 / 300 / 640 px, büyükten küçüğe).
fn pick_image(images: &Value) -> Option<String> {
    let list = images.as_array()?;
    let width = |x: &Value| x["width"].as_u64().unwrap_or(0);
    list.iter()
        .filter(|x| width(x) >= 64)
        .min_by_key(|x| width(x))
        .or(list.first())
        .and_then(|x| x["url"].as_str())
        .map(str::to_string)
}

/// Tarayıcının geri dönüş isteği: `/callback?...` ise sorgu parametreleri.
/// Başka istekler (ör. favicon) 404 alır, beklemeye devam edilir.
fn handle_callback(mut stream: TcpStream) -> Option<Vec<(String, String)>> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut buf = Vec::new();
    let mut chunk = [0u8; 2048];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") && buf.len() < 16 * 1024 {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    }
    let text = String::from_utf8_lossy(&buf);
    let target = text.lines().next()?.split(' ').nth(1)?;
    let Some(query) = target.strip_prefix("/callback?") else {
        let _ = stream
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        return None;
    };
    let params: Vec<(String, String)> = query
        .split('&')
        .filter_map(|p| p.split_once('='))
        .map(|(k, v)| (decode(k), decode(v)))
        .collect();
    let ok = params.iter().any(|(k, _)| k == "code");
    let page = callback_page(ok);
    let _ = write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
        page.len()
    );
    Some(params)
}

fn callback_page(ok: bool) -> String {
    let message = if ok {
        "Akıllı Dock Spotify'a bağlandı. Bu sekmeyi kapatabilirsin."
    } else {
        "Spotify bağlantısı tamamlanmadı. Akıllı Dock ayarlarından yeniden deneyebilirsin."
    };
    format!(
        "<!doctype html><meta charset=utf-8><title>Akıllı Dock</title>\
         <body style=\"margin:0;height:100vh;display:grid;place-items:center;\
         background:#14161c;color:#e8e8ea;font:16px 'Segoe UI',sans-serif\">\
         <p>{message}</p></body>"
    )
}

// --- yardımcılar -------------------------------------------------------------------

struct Response {
    status: u16,
    body: String,
}

/// Bekleyen bir iş parçacığında çağrılmalı.
fn http(
    method: &str,
    url: &str,
    bearer: Option<&str>,
    form_body: Option<&str>,
) -> AppResult<Response> {
    // SAFETY: bu iş parçacığı için COM başlatma; zaten başlatılmışsa zararsız.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let filter = HttpBaseProtocolFilter::new()?;
    let cache = filter.CacheControl()?;
    cache.SetReadBehavior(HttpCacheReadBehavior::NoCache)?;
    cache.SetWriteBehavior(HttpCacheWriteBehavior::NoCache)?;
    let client = HttpClient::Create(&filter)?;
    let post = method == "POST";
    let method = if post {
        HttpMethod::Post()?
    } else {
        HttpMethod::Get()?
    };
    let request = HttpRequestMessage::Create(&method, &Uri::CreateUri(&HSTRING::from(url))?)?;
    if let Some(token) = bearer {
        request.Headers()?.TryAppendWithoutValidation(
            &HSTRING::from("Authorization"),
            &HSTRING::from(format!("Bearer {token}")),
        )?;
    }
    if let Some(body) = form_body {
        let content = HttpStringContent::CreateFromStringWithEncodingAndMediaType(
            &HSTRING::from(body),
            UnicodeEncoding::Utf8,
            &HSTRING::from("application/x-www-form-urlencoded"),
        )?;
        request.SetContent(&content)?;
    } else if post {
        // Gövdesiz POST: Spotify Content-Length ister (yoksa 411).
        request.SetContent(&HttpStringContent::CreateFromString(&HSTRING::new())?)?;
    }
    let response = client
        .SendRequestAsync(&request)?
        .join()
        .map_err(|e| AppError::InvalidInput(format!("Spotify'a ulaşılamadı: {}", e.message())))?;
    let status = response.StatusCode()?.0 as u16;
    let body = response
        .Content()?
        .ReadAsStringAsync()?
        .join()?
        .to_string_lossy();
    Ok(Response { status, body })
}

/// `application/x-www-form-urlencoded` (sorgu dizesi için de).
fn form(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", encode(k), encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
                match hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(b) => {
                        out.push(b);
                        i += 2;
                    }
                    None => out.push(b'%'),
                }
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn random<const N: usize>() -> AppResult<[u8; N]> {
    let mut buf = [0u8; N];
    // SAFETY: tampon bu çağrı boyunca geçerli.
    unsafe { BCryptGenRandom(None, &mut buf, BCRYPT_USE_SYSTEM_PREFERRED_RNG) }.ok()?;
    Ok(buf)
}

fn sha256(data: &[u8]) -> AppResult<[u8; 32]> {
    let mut out = [0u8; 32];
    // SAFETY: sözde tutamaç (Windows 10+), tamponlar çağrı boyunca geçerli.
    unsafe { BCryptHash(BCRYPT_SHA256_ALG_HANDLE, None, data, &mut out) }.ok()?;
    Ok(out)
}

/// DPAPI ile şifreler (yalnızca bu Windows kullanıcısı çözebilir), base64.
fn protect(plain: &str) -> Option<String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: plain.len() as u32,
        pbData: plain.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // SAFETY: giriş tamponu çağrı boyunca geçerli; çıkış LocalFree ile bırakılır.
    unsafe {
        CryptProtectData(
            &input,
            w!("Akilli Dock Spotify"),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .ok()?;
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(Some(HLOCAL(output.pbData as _)));
        Some(STANDARD.encode(bytes))
    }
}

fn unprotect(encoded: &str) -> Option<String> {
    let mut data = STANDARD.decode(encoded).ok()?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_mut_ptr(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // SAFETY: giriş tamponu çağrı boyunca geçerli; çıkış LocalFree ile bırakılır.
    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .ok()?;
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(Some(HLOCAL(output.pbData as _)));
        String::from_utf8(bytes).ok()
    }
}

fn log(msg: &str) {
    if cfg!(debug_assertions) {
        eprintln!("[spotify] {msg}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_matches_rfc7636_example() {
        // RFC 7636 Ek B.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = URL_SAFE_NO_PAD.encode(sha256(verifier.as_bytes()).unwrap());
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn form_encoding_round_trips() {
        let s = "user-read-playback-state user-modify-playback-state";
        assert_eq!(
            encode(s),
            "user-read-playback-state%20user-modify-playback-state"
        );
        assert_eq!(decode(&encode("a b/ç?&=")), "a b/ç?&=");
        assert_eq!(decode("50%"), "50%");
    }

    #[test]
    fn dpapi_round_trips() {
        let secret = "AQDx-örnek_anahtar";
        let sealed = protect(secret).unwrap();
        assert_ne!(sealed, secret);
        assert_eq!(unprotect(&sealed).as_deref(), Some(secret));
    }

    #[test]
    fn parses_track_and_episode() {
        let track: Value = serde_json::from_str(
            r#"{"type":"track","name":"Song","uri":"spotify:track:1","duration_ms":200000,
                "artists":[{"name":"A"},{"name":"B"}],
                "album":{"images":[{"url":"big","width":640},{"url":"mid","width":300},{"url":"small","width":64}]}}"#,
        )
        .unwrap();
        let item = parse_item(&track).unwrap();
        assert_eq!(item.artist, "A, B");
        assert_eq!(item.image.as_deref(), Some("small"));

        let episode: Value = serde_json::from_str(
            r#"{"type":"episode","name":"Ep","uri":"spotify:episode:1","show":{"name":"Show"},"images":[]}"#,
        )
        .unwrap();
        let item = parse_item(&episode).unwrap();
        assert_eq!(item.artist, "Show");
        assert_eq!(item.image, None);
    }
}
