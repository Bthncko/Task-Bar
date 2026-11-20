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
//! - Şubat 2026 geliştirme modu değişiklikleri (Web API changelog, 2026-11 okundu):
//!   oynatıcı uç noktalarının hepsi duruyor (ses, ileri sarma, cihazlar, sıraya
//!   ekleme); kitaplık `PUT/DELETE /me/library?uris=`, `GET /me/library/contains`;
//!   arama en çok 10 sonuç; çalma listesi içerikleri yalnızca kullanıcının kendi
//!   listelerinde. Sıradan çıkarma / sırayı değiştirme uç noktası hiç yok →
//!   [`Edits`]: gizlenen şarkı çalmaya başlayınca hemen geçilir.
//!
//! Gizlilik: erişim/yenileme anahtarları ve yetki kodu günlüğe yazılmaz.
//! Yenileme anahtarı diskte DPAPI ile (yalnızca bu Windows kullanıcısı açabilir).
//! Ek bağımlılık yok: HTTP WinRT `HttpClient`, SHA-256 / rastgele BCrypt.

use std::collections::{BTreeSet, HashMap};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::{fs, thread};

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::Foundation::{HLOCAL, LocalFree};
use windows::Win32::Security::Cryptography::{
    BCRYPT_SHA256_ALG_HANDLE, BCRYPT_USE_SYSTEM_PREFERRED_RNG, BCryptGenRandom, BCryptHash,
    CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
};
use windows::core::w;

use crate::error::{AppError, AppResult};
use crate::services::http::{self, Body, Response};
use crate::services::launcher;

pub const SPOTIFY_CHANGED: &str = "spotify://changed";
const PORT: u16 = 43821;
pub const REDIRECT_URI: &str = "http://127.0.0.1:43821/callback";
const SCOPES: &str = "user-read-playback-state user-read-currently-playing \
     user-modify-playback-state user-library-read user-library-modify \
     playlist-read-private playlist-read-collaborative";
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
/// Sıra düzenlemeleri bu kadar eskiyse unutulur.
const EDITS_TTL: Duration = Duration::from_secs(6 * 3600);
/// Tekerlekle ses: bilinen değer bu kadar tazeyse yeniden sorulmaz.
const VOLUME_FRESH: Duration = Duration::from_secs(15);
/// Arama sonucu (geliştirme modunda en çok 10).
const SEARCH_LIMIT: u32 = 10;
/// Sıraya art arda eklemeler arası: sıra karışmasın.
const QUEUE_GAP: Duration = Duration::from_millis(80);

/// `spotify.json` (config.json'un yanında).
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Stored {
    client_id: String,
    /// DPAPI ile şifrelenmiş yenileme anahtarı (base64).
    refresh_token: Option<String>,
    account: Option<String>,
    /// Spotify'ın verdiği izinler (boşlukla ayrılmış); eski kayıtlarda yok.
    scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyStatus {
    pub client_id: String,
    pub connected: bool,
    /// Bağlı hesabın görünen adı.
    pub account: Option<String>,
    pub redirect_uri: &'static str,
    /// Bağlı ama yeni özelliklerin izinleri yok (eski bağlantı): yeniden bağlanmalı.
    pub needs_reconnect: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub uri: String,
    pub title: String,
    pub artist: String,
    pub image: Option<String>,
    pub duration_ms: u64,
    /// Spotify'ın sırasındaki yeri (gizlenenler dahil; 0 = sıradaki).
    pub position: u32,
    /// Aynı şarkının sıradaki kaçıncı geçişi (0 = ilk).
    pub occurrence: u32,
}

/// Sıra düzenlemesinde bir şarkı: Spotify sırasındaki yeri ve kimliği.
#[derive(Debug, Clone, Deserialize)]
pub struct Slot {
    pub position: u32,
    pub uri: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Queue {
    pub current: Option<QueueItem>,
    pub items: Vec<QueueItem>,
    /// Panelden kaldırılıp gizlenen şarkı sayısı.
    pub hidden: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    /// "Computer", "Smartphone", "Speaker" ...
    pub kind: String,
    pub active: bool,
    pub volume: Option<u8>,
    pub supports_volume: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub uri: Option<String>,
    pub playing: bool,
    pub progress_ms: u64,
    pub duration_ms: u64,
    /// Ölçüm anı (epoch ms): ilerleme sayfada buradan tahmin edilir.
    pub at: u64,
    pub device: Option<Device>,
    /// Beğenilenlerde mi; izin yoksa ya da bölüm değilse bilinmiyor.
    pub liked: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub uri: String,
    pub name: String,
    pub owner: String,
    pub image: Option<String>,
    pub total: Option<u64>,
}

/// Sıra düzenlemeleri. Spotify'da sıradan çıkarma ya da taşıma uç noktası yok:
/// "kaldır" şarkıyı listede gizler ve çalmaya başlayınca hemen geçer; "sıradaki
/// yap" şarkıyı sıranın başına ekler, sonraki asıl geçişini gizler.
#[derive(Default)]
struct Edits {
    /// uri → atlanacak gelecek geçişleri (0 = bir sonraki çalınışı).
    skips: HashMap<String, BTreeSet<u32>>,
    /// uri → şarkı adı (küçük harf): Windows'un "şarkı değişti" bildirimiyle eşleşme.
    titles: HashMap<String, String>,
    /// Düzenlemelerin yapıldığı bağlam (liste / albüm); değişince hepsi unutulur.
    context: Option<String>,
    since: Option<Instant>,
}

impl Edits {
    fn clear(&mut self) {
        *self = Self::default();
    }

    fn expire(&mut self) {
        if self.since.is_some_and(|t| t.elapsed() > EDITS_TTL) {
            self.clear();
        }
    }

    /// Bağlam değiştiyse eski düzenlemeleri bırakır, yenisini kaydeder.
    fn begin(&mut self, context: Option<String>) {
        self.expire();
        if self.skips.is_empty() || self.context != context {
            self.clear();
            self.context = context;
        }
        self.since = Some(Instant::now());
    }

    fn hides(&self, uri: &str, occurrence: u32) -> bool {
        self.skips.get(uri).is_some_and(|s| s.contains(&occurrence))
    }

    fn add(&mut self, uri: &str, title: &str, occurrence: u32) {
        self.skips.entry(uri.into()).or_default().insert(occurrence);
        self.titles.insert(uri.into(), title.trim().to_lowercase());
    }

    /// Şarkı `times` kez geçti (çalındı ya da üzerinden atlandı). İlk geçişi
    /// gizliyse `true` (çalmaya başladıysa atlanmalı).
    fn consume(&mut self, uri: &str, times: u32) -> bool {
        let Some(set) = self.skips.get_mut(uri) else {
            return false;
        };
        let first_hidden = set.contains(&0);
        *set = set
            .iter()
            .filter(|&&i| i >= times)
            .map(|i| i - times)
            .collect();
        if set.is_empty() {
            self.skips.remove(uri);
            self.titles.remove(uri);
        }
        first_hidden
    }

    fn matches_title(&self, title: &str) -> bool {
        let title = title.trim().to_lowercase();
        !title.is_empty() && self.titles.values().any(|t| *t == title)
    }
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
    edits: Mutex<Edits>,
    /// Son bilinen ses (tekerlek için) ve sessize almadan önceki değer.
    volume: Mutex<Option<(u8, Instant)>>,
    unmute_to: Mutex<Option<u8>>,
    /// İzinler öğrenildi / değişti: ayarlara ve panele haber verilecek.
    scope_changed: AtomicBool,
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
            edits: Mutex::new(Edits::default()),
            volume: Mutex::new(None),
            unmute_to: Mutex::new(None),
            scope_changed: AtomicBool::new(false),
        }
    }

    pub fn status(&self) -> SpotifyStatus {
        let inner = self.inner.lock().unwrap();
        let connected = inner.refresh.is_some();
        SpotifyStatus {
            client_id: inner.stored.client_id.clone(),
            connected,
            account: inner.stored.account.clone(),
            redirect_uri: REDIRECT_URI,
            needs_reconnect: connected
                && inner
                    .stored
                    .scope
                    .as_deref()
                    .is_some_and(|s| !has_all_scopes(s)),
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
        let (refresh, access, expires_in, scope) = result?;

        {
            let mut inner = self.inner.lock().unwrap();
            inner.stored.client_id = client_id;
            inner.refresh = Some(refresh);
            inner.access = Some((access, expires_at(expires_in)));
            inner.stored.account = None;
            inner.stored.scope = scope;
        }
        self.edits.lock().unwrap().clear();
        // Hesap adı yalnızca gösterim için; alınamazsa bağlantı yine geçerli.
        match self.call("GET", "/me", None) {
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

    /// Spotify'ın sırası; panelden kaldırılanlar gizlenir.
    pub fn queue(&self, app: &AppHandle) -> AppResult<Queue> {
        let (current, raw) = self.raw_queue(app)?;
        let mut edits = self.edits.lock().unwrap();
        edits.expire();
        let before = raw.len();
        let items: Vec<QueueItem> = raw
            .into_iter()
            .filter(|i| !edits.hides(&i.uri, i.occurrence))
            .collect();
        Ok(Queue {
            current,
            hidden: (before - items.len()) as u32,
            items,
        })
    }

    /// Gizlemesiz sıra; her öğenin yeri ve aynı şarkının kaçıncı geçişi olduğu.
    fn raw_queue(&self, app: &AppHandle) -> AppResult<(Option<QueueItem>, Vec<QueueItem>)> {
        let body = self.call_checked(app, "GET", "/me/player/queue")?;
        // Çalan bir şey yoksa gövde boş olabilir.
        let json: Value = serde_json::from_str(&body).unwrap_or_default();
        let current = parse_item(&json["currently_playing"]);
        let mut seen: HashMap<String, u32> = HashMap::new();
        let items = json["queue"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(parse_item)
                    .enumerate()
                    .map(|(i, mut item)| {
                        let n = seen.entry(item.uri.clone()).or_default();
                        item.position = i as u32;
                        item.occurrence = *n;
                        *n += 1;
                        item
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok((current, items))
    }

    /// Sıradaki listeden bir öğeyi çal (`position`: Spotify sırasındaki yeri).
    ///
    /// Çalan şey bir çalma listesi ya da albümse şarkı o listenin içinde doğrudan
    /// başlatılır (`PUT /me/player/play`, `context_uri` + `offset.uri`; belgeye
    /// göre offset yalnızca albüm ve çalma listesinde): araya giren şarkılar tek
    /// tek geçilmez, listenin devamı korunur. Başka bağlamda (sanatçı, radyo) ya
    /// da öğe listede yoksa (elle sıraya eklenmiş) eski yol: o öğeye kadar "sonraki".
    pub fn play_item(&self, app: &AppHandle, position: u32, uri: &str) -> AppResult<()> {
        // Üzerinden geçilecek gizli şarkılar artık beklenmez.
        if let Ok((_, raw)) = self.raw_queue(app) {
            let mut passed: HashMap<&str, u32> = HashMap::new();
            for item in raw.iter().take(position as usize) {
                *passed.entry(&item.uri).or_default() += 1;
            }
            let mut edits = self.edits.lock().unwrap();
            for (uri, times) in passed {
                edits.consume(uri, times);
            }
        }
        let (_, context, kind) = self.playback_context(app)?;
        if let Some(context_uri) = context
            && matches!(kind.as_deref(), Some("album" | "playlist"))
            && uri.starts_with("spotify:")
        {
            let body = serde_json::json!({
                "context_uri": context_uri,
                "offset": { "uri": uri },
            })
            .to_string();
            match self.call_json(app, "PUT", "/me/player/play", Some(&body)) {
                Ok(_) => {
                    log("liste içinde doğrudan çalındı");
                    return Ok(());
                }
                Err(e) => log(&format!("doğrudan çalınamadı ({e}); sırayla geçiliyor")),
            }
        }
        self.skip(app, position + 1)
    }

    /// (çalan öğenin uri'si, bağlam uri'si, bağlam türü).
    fn playback_context(
        &self,
        app: &AppHandle,
    ) -> AppResult<(Option<String>, Option<String>, Option<String>)> {
        let body = self.call_checked(app, "GET", "/me/player")?;
        let json: Value = serde_json::from_str(&body).unwrap_or_default();
        let s = |v: &Value| v.as_str().map(str::to_string);
        Ok((
            s(&json["item"]["uri"]),
            s(&json["context"]["uri"]),
            s(&json["context"]["type"]),
        ))
    }

    // --- sıra düzenleme ------------------------------------------------------------

    /// Şarkıyı sıradan "çıkar": listede gizlenir, çalmaya başlarsa hemen geçilir.
    pub fn queue_remove(
        &self,
        app: &AppHandle,
        uri: &str,
        occurrence: u32,
        title: &str,
    ) -> AppResult<()> {
        let (_, context, _) = self.playback_context(app)?;
        let mut edits = self.edits.lock().unwrap();
        edits.begin(context);
        edits.add(uri, title, occurrence);
        Ok(())
    }

    /// Sırayı yeniden düzenle (panelde sürükle-bırak, "sıradaki yap").
    ///
    /// `order`: sıranın başının istenen hâli (Spotify sırasındaki yerleriyle).
    /// Spotify'da sırayı değiştiren uç nokta yok; bu yüzden bu şarkıların
    /// kopyaları istenen sırayla Spotify'ın "sıradakiler" bölümüne eklenir
    /// (o bölüm listenin önünde çalar, eklenen en sona gider), asılları gizlenir
    /// ve gelince geçilir. Eklenenlerin nereye düştüğü sıra yeniden okunarak
    /// bulunur: Spotify'da önceden elle eklenmiş şarkılar varsa da doğru kalır.
    pub fn queue_reorder(&self, app: &AppHandle, order: &[Slot]) -> AppResult<()> {
        if order.is_empty() || order.len() > MAX_SKIP as usize {
            return Err(AppError::InvalidInput("Geçersiz sıra.".into()));
        }
        let (_, context, _) = self.playback_context(app)?;
        let (_, before) = self.raw_queue(app)?;
        let before: Vec<String> = before.into_iter().map(|i| i.uri).collect();
        for slot in order {
            check_uri(&slot.uri)?;
            if before.get(slot.position as usize) != Some(&slot.uri) {
                return Err(AppError::InvalidInput(
                    "Spotify'ın sırası bu arada değişti; yeniden dene.".into(),
                ));
            }
        }

        // Kopyaları sırayla ekle; yarıda kalırsa eklenenler kadarı uygulanır.
        let mut added: Vec<&Slot> = Vec::new();
        let mut failure = None;
        for (i, slot) in order.iter().enumerate() {
            if i > 0 {
                thread::sleep(QUEUE_GAP);
            }
            match self.add_to_queue(app, &slot.uri) {
                Ok(()) => added.push(slot),
                Err(e) => {
                    failure = Some(e);
                    break;
                }
            }
        }
        if added.is_empty() {
            return Err(failure.unwrap_or_else(|| AppError::InvalidInput("Sıra değişmedi.".into())));
        }
        let copies: Vec<String> = added.iter().map(|s| s.uri.clone()).collect();

        // Eklenenler sıranın neresine düştü (Spotify sırayı biraz geç günceller).
        let mut at = None;
        for _ in 0..4 {
            thread::sleep(Duration::from_millis(250));
            if let Ok((_, after)) = self.raw_queue(app) {
                let after: Vec<String> = after.into_iter().map(|i| i.uri).collect();
                at = find_insert(&before, &after, &copies);
                if at.is_some() {
                    break;
                }
            }
        }
        let at = at.unwrap_or_else(|| {
            log("eklenenlerin yeri bulunamadı; başa eklendi sayılıyor");
            0
        });

        let mut edits = self.edits.lock().unwrap();
        edits.begin(context);
        // Şimdiye kadar gizlenenler + kopyası eklenenlerin asılları.
        let mut hidden: BTreeSet<usize> = occurrences(&before)
            .into_iter()
            .enumerate()
            .filter(|(p, occ)| edits.hides(&before[*p], *occ))
            .map(|(p, _)| p)
            .collect();
        hidden.extend(added.iter().map(|s| s.position as usize));
        edits.skips = remap(&before, &hidden, &edits.skips, &copies, at);
        for slot in &added {
            edits
                .titles
                .insert(slot.uri.clone(), slot.title.trim().to_lowercase());
        }
        let keep: Vec<String> = edits.skips.keys().cloned().collect();
        edits.titles.retain(|uri, _| keep.contains(uri));
        drop(edits);

        match failure {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }

    /// Panelden yapılan sıra düzenlemelerini unut (gizlenenler yeniden görünür).
    pub fn queue_reset(&self) {
        self.edits.lock().unwrap().clear();
    }

    /// Windows "şarkı değişti" dedi (`media.rs`). Gizlenmiş bir şarkıysa geç.
    /// Ağ çağrısı yalnızca şarkı adı bir düzenlemeyle eşleşirse yapılır.
    pub fn track_changed(app: &AppHandle, title: &str) {
        let spotify = app.state::<Spotify>();
        {
            let mut edits = spotify.edits.lock().unwrap();
            edits.expire();
            if !edits.matches_title(title) {
                return;
            }
        }
        let app = app.clone();
        thread::spawn(move || {
            let spotify = app.state::<Spotify>();
            let Ok((Some(uri), context, _)) = spotify.playback_context(&app) else {
                return;
            };
            let skip = {
                let mut edits = spotify.edits.lock().unwrap();
                if edits.context != context {
                    // Başka bir liste çalıyor: eski düzenlemeler geçersiz.
                    edits.clear();
                    return;
                }
                edits.consume(&uri, 1)
            };
            if skip {
                log("sıradan kaldırılan şarkı geçildi");
                let _ = spotify.call_checked(&app, "POST", "/me/player/next");
            }
        });
    }

    // --- oynatıcı ------------------------------------------------------------------

    /// Çalma durumu; hiçbir cihazda bir şey yoksa `None`.
    pub fn player(&self, app: &AppHandle) -> AppResult<Option<Player>> {
        let body = self.call_checked(app, "GET", "/me/player")?;
        let json: Value = serde_json::from_str(&body).unwrap_or_default();
        if json.is_null() || json["device"].is_null() {
            return Ok(None);
        }
        let device = parse_device(&json["device"]);
        if let Some(v) = device.as_ref().and_then(|d| d.volume) {
            *self.volume.lock().unwrap() = Some((v, Instant::now()));
        }
        let item = &json["item"];
        let uri = item["uri"].as_str().map(str::to_string);
        let liked = match &uri {
            Some(u) if u.starts_with("spotify:track:") || u.starts_with("spotify:episode:") => {
                self.is_liked(app, u)
            }
            _ => None,
        };
        Ok(Some(Player {
            uri,
            playing: json["is_playing"].as_bool().unwrap_or(false),
            progress_ms: json["progress_ms"].as_u64().unwrap_or(0),
            duration_ms: item["duration_ms"].as_u64().unwrap_or(0),
            at: now_ms(),
            device,
            liked,
        }))
    }

    fn is_liked(&self, app: &AppHandle, uri: &str) -> Option<bool> {
        if !self.has_scope("user-library-read") {
            return None;
        }
        let path = format!("/me/library/contains?uris={}", encode(uri));
        let body = self.call_checked(app, "GET", &path).ok()?;
        let json: Value = serde_json::from_str(&body).ok()?;
        json.get(0)?.as_bool()
    }

    /// Beğenilenlere ekle / çıkar.
    pub fn set_liked(&self, app: &AppHandle, uri: &str, liked: bool) -> AppResult<()> {
        let path = format!("/me/library?uris={}", encode(uri));
        let method = if liked { "PUT" } else { "DELETE" };
        self.call_checked(app, method, &path).map(drop)
    }

    pub fn set_volume(&self, app: &AppHandle, percent: u8) -> AppResult<u8> {
        let percent = percent.min(100);
        let path = format!("/me/player/volume?volume_percent={percent}");
        self.call_checked(app, "PUT", &path)?;
        *self.volume.lock().unwrap() = Some((percent, Instant::now()));
        if percent > 0 {
            *self.unmute_to.lock().unwrap() = None;
        }
        Ok(percent)
    }

    /// Tekerlekle: bilinen sesten `delta` kadar.
    pub fn volume_step(&self, app: &AppHandle, delta: i32) -> AppResult<u8> {
        let known = self
            .volume
            .lock()
            .unwrap()
            .filter(|(_, at)| at.elapsed() < VOLUME_FRESH)
            .map(|(v, _)| v);
        let current = match known {
            Some(v) => v,
            None => self
                .player(app)?
                .and_then(|p| p.device)
                .and_then(|d| d.volume)
                .ok_or_else(|| {
                    AppError::InvalidInput("Bu Spotify cihazının sesi ayarlanamıyor.".into())
                })?,
        };
        let next = (current as i32 + delta).clamp(0, 100) as u8;
        if next == current {
            return Ok(current);
        }
        self.set_volume(app, next)
    }

    /// Sessize al / önceki sese dön.
    pub fn toggle_mute(&self, app: &AppHandle, current: u8) -> AppResult<u8> {
        let restore = self.unmute_to.lock().unwrap().take();
        if current == 0 {
            return self.set_volume(app, restore.unwrap_or(50).max(1));
        }
        let v = self.set_volume(app, 0)?;
        *self.unmute_to.lock().unwrap() = Some(current);
        Ok(v)
    }

    pub fn seek(&self, app: &AppHandle, position_ms: u64) -> AppResult<()> {
        let path = format!("/me/player/seek?position_ms={position_ms}");
        self.call_checked(app, "PUT", &path).map(drop)
    }

    pub fn devices(&self, app: &AppHandle) -> AppResult<Vec<Device>> {
        let body = self.call_checked(app, "GET", "/me/player/devices")?;
        let json: Value = serde_json::from_str(&body).unwrap_or_default();
        Ok(json["devices"]
            .as_array()
            .map(|a| a.iter().filter_map(parse_device).collect())
            .unwrap_or_default())
    }

    /// Çalmayı başka cihaza aktar (çalıyorsa orada sürer).
    pub fn transfer(&self, app: &AppHandle, device_id: &str) -> AppResult<()> {
        let body = serde_json::json!({ "device_ids": [device_id] }).to_string();
        self.call_json(app, "PUT", "/me/player", Some(&body))?;
        *self.volume.lock().unwrap() = None;
        Ok(())
    }

    // --- arama, sıraya ekleme, listeler -----------------------------------------

    pub fn search(&self, app: &AppHandle, query: &str) -> AppResult<Vec<QueueItem>> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let path = format!(
            "/search?{}",
            form(&[
                ("q", query),
                ("type", "track"),
                ("limit", &SEARCH_LIMIT.to_string()),
            ])
        );
        let body = self.call_checked(app, "GET", &path)?;
        let json: Value = serde_json::from_str(&body).unwrap_or_default();
        Ok(json["tracks"]["items"]
            .as_array()
            .map(|a| a.iter().filter_map(parse_item).collect())
            .unwrap_or_default())
    }

    /// Sıranın sonuna değil, Spotify'ın "sıradakiler" bölümüne (listenin önüne) ekler.
    pub fn add_to_queue(&self, app: &AppHandle, uri: &str) -> AppResult<()> {
        check_uri(uri)?;
        let path = format!("/me/player/queue?uri={}", encode(uri));
        self.call_checked(app, "POST", &path).map(drop)
    }

    /// Şarkıyı hemen çal (Spotify uygulamasındaki gibi: devamında Spotify öneri çalar).
    pub fn play_uri(&self, app: &AppHandle, uri: &str) -> AppResult<()> {
        check_uri(uri)?;
        let body = serde_json::json!({ "uris": [uri] }).to_string();
        self.call_json(app, "PUT", "/me/player/play", Some(&body))
            .map(drop)
    }

    /// Çalma listesini / albümü baştan çal.
    pub fn play_context(&self, app: &AppHandle, uri: &str) -> AppResult<()> {
        check_uri(uri)?;
        let body = serde_json::json!({ "context_uri": uri }).to_string();
        self.call_json(app, "PUT", "/me/player/play", Some(&body))
            .map(drop)
    }

    /// Kullanıcının çalma listeleri (Beğenilenler hariç; o ayrı bir koleksiyon).
    pub fn playlists(&self, app: &AppHandle) -> AppResult<Vec<Playlist>> {
        let body = self.call_checked(app, "GET", "/me/playlists?limit=50")?;
        let json: Value = serde_json::from_str(&body).unwrap_or_default();
        Ok(json["items"]
            .as_array()
            .map(|a| a.iter().filter_map(parse_playlist).collect())
            .unwrap_or_default())
    }

    fn has_scope(&self, scope: &str) -> bool {
        let inner = self.inner.lock().unwrap();
        // Bilinmiyorsa (eski kayıt) dene; izin yoksa Spotify 403 döner.
        inner
            .stored
            .scope
            .as_deref()
            .is_none_or(|s| s.split(' ').any(|x| x == scope))
    }

    /// Kuyruktaki `count`. öğeye geç (1 = sıradaki).
    fn skip(&self, app: &AppHandle, count: u32) -> AppResult<()> {
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
        self.call_json(app, method, path, None)
    }

    fn call_json(
        &self,
        app: &AppHandle,
        method: &str,
        path: &str,
        json: Option<&str>,
    ) -> AppResult<String> {
        let result = self.call(method, path, json).inspect_err(|e| {
            if matches!(e, AppError::InvalidInput(m) if m == EXPIRED)
                && self.inner.lock().unwrap().refresh.is_none()
            {
                let _ = self.save();
                let _ = app.emit(SPOTIFY_CHANGED, &self.status());
            }
        });
        // Anahtar yenilenirken izinler öğrenildi: "yeniden bağlan" uyarısı için.
        if self.scope_changed.swap(false, Ordering::SeqCst) {
            let _ = self.save();
            let _ = app.emit(SPOTIFY_CHANGED, &self.status());
        }
        result
    }

    /// Yetkili API çağrısı; 401'de anahtarı bir kez yenileyip tekrar dener.
    fn call(&self, method: &str, path: &str, json: Option<&str>) -> AppResult<String> {
        let url = format!("{API}{path}");
        let mut retried = false;
        loop {
            let token = self.access_token(retried)?;
            let res = http(method, &url, Some(&token), json.map(Body::Json))?;
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
        let res = http("POST", TOKEN_URL, None, Some(Body::Form(&body)))?;
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
        if let Some(scope) = json["scope"].as_str()
            && inner.stored.scope.as_deref() != Some(scope)
        {
            inner.stored.scope = Some(scope.to_string());
            self.scope_changed.store(true, Ordering::SeqCst);
        }
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

    /// PKCE girişi: (yenileme anahtarı, erişim anahtarı, süre sn, verilen izinler).
    fn login(&self, client_id: &str) -> AppResult<(String, String, u64, Option<String>)> {
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
        let res = http("POST", TOKEN_URL, None, Some(Body::Form(&body)))?;
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
                json["scope"].as_str().map(str::to_string),
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
    let detail = json["error"]["message"].as_str().unwrap_or("");
    let message = match (status, reason) {
        (_, "PREMIUM_REQUIRED") => "Bu işlem Spotify Premium ister.".to_string(),
        (403, _) if detail.to_lowercase().contains("scope") => {
            "Bu özellik için Spotify'ı yeniden bağla (Ayarlar → Müzik).".to_string()
        }
        (_, "VOLUME_CONTROL_DISALLOW") => "Bu Spotify cihazının sesi ayarlanamıyor.".to_string(),
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
        position: 0,
        occurrence: 0,
    })
}

fn parse_device(v: &Value) -> Option<Device> {
    Some(Device {
        id: v["id"].as_str()?.to_string(),
        name: v["name"].as_str().unwrap_or_default().to_string(),
        kind: v["type"].as_str().unwrap_or_default().to_string(),
        active: v["is_active"].as_bool().unwrap_or(false),
        volume: v["volume_percent"].as_u64().map(|x| x.min(100) as u8),
        supports_volume: v["supports_volume"].as_bool().unwrap_or(false),
    })
}

fn parse_playlist(v: &Value) -> Option<Playlist> {
    Some(Playlist {
        uri: v["uri"].as_str()?.to_string(),
        name: v["name"].as_str().unwrap_or_default().to_string(),
        owner: v["owner"]["display_name"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        image: pick_image(&v["images"]),
        // Şubat 2026: `tracks` → `items` (eski adı da okunur).
        total: v["items"]["total"]
            .as_u64()
            .or_else(|| v["tracks"]["total"].as_u64()),
    })
}

/// Panelden gelen uri yalnızca Spotify uri'si olabilir.
fn check_uri(uri: &str) -> AppResult<()> {
    let ok = uri.starts_with("spotify:")
        && uri.len() < 128
        && uri.bytes().all(|b| b.is_ascii_alphanumeric() || b == b':');
    if ok {
        Ok(())
    } else {
        Err(AppError::InvalidInput(
            "Geçersiz Spotify bağlantısı.".into(),
        ))
    }
}

/// Her öğe için: aynı şarkının listede kaçıncı geçişi (0'dan).
fn occurrences(uris: &[String]) -> Vec<u32> {
    let mut seen: HashMap<&str, u32> = HashMap::new();
    uris.iter()
        .map(|u| {
            let n = seen.entry(u.as_str()).or_default();
            *n += 1;
            *n - 1
        })
        .collect()
}

/// Sıraya eklenen `copies` öncekine (`before`) göre hangi yere düştü:
/// `after` = before[..m] + copies + before[m..] (API en çok 20 öğe gösterir).
fn find_insert(before: &[String], after: &[String], copies: &[String]) -> Option<usize> {
    (0..=before.len()).find(|&m| {
        let expected: Vec<&String> = before[..m]
            .iter()
            .chain(copies)
            .chain(&before[m..])
            .collect();
        after.len() >= expected.len().min(MAX_SKIP as usize)
            && after.len() <= expected.len()
            && after.iter().zip(&expected).all(|(a, e)| a == *e)
    })
}

/// Düzenlemeden sonra gizlenecek geçişler. `hidden`: `before`'daki gizli yerler
/// (eskiler + kopyası eklenenlerin asılları); `m`: kopyaların düştüğü yer.
/// Kopyalar bir şarkının gizli geçişinden önce düştüyse o geçişin sırası kayar.
/// Görünen 20 öğenin ötesindeki eski gizlemeler de kopyalar kadar kayar.
fn remap(
    before: &[String],
    hidden: &BTreeSet<usize>,
    old: &HashMap<String, BTreeSet<u32>>,
    copies: &[String],
    m: usize,
) -> HashMap<String, BTreeSet<u32>> {
    let occ = occurrences(before);
    let count = |list: &[String], uri: &str| list.iter().filter(|u| *u == uri).count() as u32;
    let mut out: HashMap<String, BTreeSet<u32>> = HashMap::new();
    for &p in hidden {
        let Some(uri) = before.get(p) else { continue };
        let shift = if p >= m { count(copies, uri) } else { 0 };
        out.entry(uri.clone()).or_default().insert(occ[p] + shift);
    }
    for (uri, set) in old {
        let seen = count(before, uri);
        for &i in set.iter().filter(|&&i| i >= seen) {
            out.entry(uri.clone())
                .or_default()
                .insert(i + count(copies, uri));
        }
    }
    out
}

fn has_all_scopes(granted: &str) -> bool {
    SCOPES
        .split_whitespace()
        .all(|s| granted.split(' ').any(|g| g == s))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
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
    let app = crate::i18n::app_name();
    let message = match (crate::i18n::english(), ok) {
        (false, true) => format!("{app} Spotify'a bağlandı. Bu sekmeyi kapatabilirsin."),
        (false, false) => {
            format!("Spotify bağlantısı tamamlanmadı. {app} ayarlarından yeniden deneyebilirsin.")
        }
        (true, true) => format!("{app} is now connected to Spotify. You can close this tab."),
        (true, false) => {
            format!("Spotify wasn't connected. You can try again from the {app} settings.")
        }
    };
    format!(
        "<!doctype html><meta charset=utf-8><title>{app}</title>\
         <body style=\"margin:0;height:100vh;display:grid;place-items:center;\
         background:#14161c;color:#e8e8ea;font:16px 'Segoe UI',sans-serif\">\
         <p>{message}</p></body>"
    )
}

// --- yardımcılar -------------------------------------------------------------------

/// Bekleyen bir iş parçacığında çağrılmalı.
fn http(method: &str, url: &str, bearer: Option<&str>, body: Option<Body>) -> AppResult<Response> {
    let auth = bearer.map(|t| format!("Bearer {t}"));
    let headers: Vec<(&str, &str)> = auth.iter().map(|a| ("Authorization", a.as_str())).collect();
    http::request(method, url, &headers, body)
        .map_err(|e| AppError::InvalidInput(format!("Spotify'a ulaşılamadı: {}", e.message())))
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
    fn edits_hide_and_skip_the_right_occurrence() {
        let mut e = Edits::default();
        e.begin(Some("ctx".into()));
        // "Kaldır": ilk geçiş gizli, çalmaya başlayınca atlanır.
        e.add("spotify:track:a", "Song A", 0);
        assert!(e.hides("spotify:track:a", 0));
        assert!(e.matches_title(" song a "));
        assert!(e.consume("spotify:track:a", 1));
        assert!(!e.matches_title("Song A"));

        // Başa kopyası eklenen: ilk geçiş (kopya) çalar, ikincisi (asıl) atlanır.
        e.add("spotify:track:b", "Song B", 1);
        assert!(!e.hides("spotify:track:b", 0));
        assert!(e.hides("spotify:track:b", 1));
        assert!(!e.consume("spotify:track:b", 1));
        assert!(e.hides("spotify:track:b", 0));
        assert!(e.consume("spotify:track:b", 1));
        assert!(e.skips.is_empty());

        // Bağlam değişince düzenlemeler unutulur.
        e.add("spotify:track:c", "C", 0);
        e.begin(Some("other".into()));
        assert!(!e.hides("spotify:track:c", 0));
    }

    fn uris(list: &str) -> Vec<String> {
        list.split_whitespace().map(str::to_string).collect()
    }

    /// Gizlenenler çıkarılınca panelde görünen sıra.
    fn visible(list: &[String], skips: &HashMap<String, BTreeSet<u32>>) -> String {
        list.iter()
            .zip(occurrences(list))
            .filter(|(u, o)| !skips.get(*u).is_some_and(|s| s.contains(o)))
            .map(|(u, _)| u.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    }

    #[test]
    fn reorder_by_copies_keeps_the_wanted_order() {
        // D'yi ikinci sıraya sürükle: baştan D'nin eski yerine kadar kopyalanır.
        let before = uris("A B C D E");
        let copies = uris("A D B C");
        let after = uris("A D B C A B C D E");
        let m = find_insert(&before, &after, &copies).unwrap();
        assert_eq!(m, 0);
        let hidden: BTreeSet<usize> = [0, 1, 2, 3].into();
        let skips = remap(&before, &hidden, &HashMap::new(), &copies, m);
        assert_eq!(visible(&after, &skips), "A D B C E");

        // Spotify'da önceden elle eklenmiş X var: kopyalar onun arkasına düşer.
        let before = uris("X A B C");
        let copies = uris("C X A B");
        let after = uris("X C X A B A B C");
        let m = find_insert(&before, &after, &copies).unwrap();
        assert_eq!(m, 1);
        let skips = remap(&before, &[0, 1, 2, 3].into(), &HashMap::new(), &copies, m);
        assert_eq!(visible(&after, &skips), "C X A B");

        // Önceden kaldırılmış (B#0) gizli kalır; görünen 20'nin ötesindeki gizleme kayar.
        let before = uris("A B C");
        let old: HashMap<String, BTreeSet<u32>> =
            [("B".to_string(), [0, 5].into())].into_iter().collect();
        let copies = uris("C A");
        let after = uris("C A A B C");
        let m = find_insert(&before, &after, &copies).unwrap();
        let skips = remap(&before, &[0, 1, 2].into(), &old, &copies, m);
        assert_eq!(visible(&after, &skips), "C A");
        assert!(skips["B"].contains(&5));

        // Spotify sırayı henüz güncellemediyse yer bulunamaz.
        assert_eq!(find_insert(&uris("A B"), &uris("A B"), &uris("B")), None);
    }

    #[test]
    fn scopes_and_uris() {
        assert!(has_all_scopes(SCOPES));
        assert!(!has_all_scopes(
            "user-read-playback-state user-modify-playback-state"
        ));
        assert!(check_uri("spotify:track:7a3LWj5xSFhFRYmztS8wgK").is_ok());
        assert!(check_uri("spotify:track:x&uri=evil").is_err());
        assert!(check_uri("https://example.com").is_err());
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
