//! AI kullanımı (8.9): Claude hesabındaki oturum (5 saat) ve haftalık limit
//! yüzdeleri, sıfırlanma zamanlarıyla; ayrıca bu bilgisayardaki Claude Code
//! etkinliği (günlük grafik, model payları).
//!
//! Doğrulananlar (2026-11-17):
//! - Limitler: Claude Code'un `/usage` ekranının kullandığı
//!   `GET api.anthropic.com/api/oauth/usage` (`anthropic-beta: oauth-2025-04-20`,
//!   Claude Code'un kendi oturum token'ı `~/.claude/.credentials.json` →
//!   `claudeAiOauth.accessToken`). Yanıtta `limits: [{kind: "session" |
//!   "weekly_all" | ..., percent, severity, resets_at}]` ve eski biçim
//!   `five_hour` / `seven_day: {utilization, resets_at}` var. Belgelenmemiş uç
//!   nokta: biçim değişirse limitler "alınamadı" görünür, gerisi çalışır.
//!   Token yalnızca okunur, hiçbir yere yazılmaz / günlüğe düşmez; süresi
//!   dolmuşsa yenilenmez (yenilemek Claude Code'un oturumunu bozabilir),
//!   Claude Code kullanılınca kendisi yeniler.
//! - Resmi durum satırı (`rate_limits`) VS Code eklentisinde çalışmıyor (denendi).
//! - Kayıtlar `~/.claude/projects/**/*.jsonl`; `type: "assistant"` satırlarında
//!   `message.id`, `message.model`, `message.usage`, `timestamp`. Bir yanıt
//!   birden çok satır yazar → `message.id` ile bir kez sayılır. Ağırlık API
//!   liste fiyatı (ham token sayısı yanıltıcı: önbellekten okuma ucuz ama
//!   baskın); yalnızca oran olarak gösterilir. Mesaj metni hiç saklanmaz.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

use super::{http, runner};

pub const AI_USAGE_CHANGED: &str = "ai-usage://changed";
const POLL: Duration = Duration::from_secs(60);
const HOUR_MS: i64 = 3_600_000;
const WEEK_MS: i64 = 7 * 24 * HOUR_MS;
/// Bundan eski kayıtlar okunmaz / unutulur (grafikte 7 tam gün için 8).
const KEEP_MS: i64 = 8 * 24 * HOUR_MS;
/// Tek seferde bir dosyadan en çok bu kadar okunur (ilk taramada belleği korur).
const CHUNK: usize = 8 * 1024 * 1024;
/// Limitler bu aralıkla sorulur (uç nokta sık sorulunca 429 verir).
const LIMITS_EVERY_MS: i64 = 2 * 60_000;
/// Panel açılınca beklemeden sorulur, ama son denemeden en az bu kadar sonra.
const LIMITS_MIN_GAP_MS: i64 = 20_000;
/// 429 sonrası bekleme.
const LIMITS_BACKOFF_MS: i64 = 10 * 60_000;
const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiUsage {
    /// Hesaptaki limitler (`/usage` ile aynı); hiç alınamadıysa `None`.
    pub limits: Option<Limits>,
    /// Son deneme başarısızsa nedeni (önceki değer gösterilmeye devam eder).
    pub limits_error: Option<String>,
    /// Bu bilgisayardaki Claude Code kayıtları; klasör yoksa `None`.
    pub activity: Option<Activity>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    /// Oturum: 5 saatlik pencere.
    pub session: Option<Limit>,
    /// Haftalık (tüm modeller).
    pub weekly: Option<Limit>,
    /// Varsa ek limitler (ör. modele özel haftalık).
    pub other: Vec<Limit>,
    /// Alındığı an (epoch ms).
    pub fetched_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Limit {
    pub label: String,
    /// 0–100.
    pub percent: f64,
    /// Sıfırlanma (epoch ms); pencere başlamadıysa `None`.
    pub resets_at: Option<i64>,
    /// Claude'un kendi uyarı eşiği aşıldı.
    pub warning: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    /// Son 8 günün saatlik ağırlıkları: (saat başı, epoch ms; API fiyatıyla $).
    /// Yalnızca oran için; gün gruplaması sayfada yerel saate göre.
    pub hourly: Vec<(i64, f64)>,
    /// Son 7 gün, model başına (büyükten küçüğe).
    pub models: Vec<ModelUsage>,
    /// Son 7 gün token toplamları.
    pub tokens: Tokens,
    /// Son 7 gündeki istek sayısı.
    pub requests: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    /// "Opus 5.5", "Sonnet 5.5" ...
    pub name: String,
    /// Son 7 günkü kullanımdaki payı (%; API fiyatıyla ağırlıklı).
    pub share: f64,
    pub requests: u32,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
}

/// `None`: ne Claude oturumu ne kayıt klasörü var → widget gizlenir.
pub type AiUsageService = runner::ServiceHandle<Option<AiUsage>, Refresh>;

/// Paneli açınca: beklemeden yeniden oku / sor.
pub struct Refresh;

pub fn spawn(app: &tauri::AppHandle) {
    runner::spawn(app, "ai-usage", AI_USAGE_CHANGED, POLL, None, |_| {
        let mut scanner = Scanner::default();
        let mut limits = LimitsFetcher::default();
        move |cmd: Option<Refresh>| {
            let dir = claude_dir()?;
            let now = now_ms();
            let has_login = dir.join(".credentials.json").is_file();
            if has_login {
                limits.update(&dir, now, cmd.is_some());
            }
            let projects = dir.join("projects");
            let activity = projects.is_dir().then(|| {
                scanner.scan(&projects, now);
                scanner.summary(now)
            });
            if !has_login && activity.is_none() {
                return None;
            }
            Some(AiUsage {
                limits: limits.last.clone(),
                limits_error: limits.error.clone(),
                activity,
            })
        }
    });
}

/// Claude Code'un klasörü (`CLAUDE_CONFIG_DIR` ya da `~/.claude`).
fn claude_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        return Some(PathBuf::from(dir));
    }
    let home = std::env::var_os("USERPROFILE")?;
    Some(PathBuf::from(home).join(".claude"))
}

// --- limitler ------------------------------------------------------------------------

#[derive(Default)]
struct LimitsFetcher {
    last: Option<Limits>,
    error: Option<String>,
    /// Son deneme ve bir sonraki olağan deneme (epoch ms).
    tried_at: i64,
    next_at: i64,
}

impl LimitsFetcher {
    fn update(&mut self, dir: &Path, now: i64, forced: bool) {
        let due = now >= self.next_at || (forced && now - self.tried_at >= LIMITS_MIN_GAP_MS);
        if !due {
            return;
        }
        self.tried_at = now;
        self.next_at = now + LIMITS_EVERY_MS;
        match fetch_limits(dir, now) {
            Ok(limits) => {
                self.last = Some(limits);
                self.error = None;
            }
            Err(e) => {
                if e.rate_limited {
                    self.next_at = now + LIMITS_BACKOFF_MS;
                }
                self.error = Some(e.message);
            }
        }
    }
}

struct FetchError {
    message: String,
    rate_limited: bool,
}

impl FetchError {
    fn new(message: &str) -> Self {
        Self {
            message: message.to_string(),
            rate_limited: false,
        }
    }
}

const NO_LOGIN: &str = "Claude Code'da oturum açık değil.";
const EXPIRED: &str =
    "Claude oturumunun süresi dolmuş; Claude Code'u kullanınca kendiliğinden yenilenir.";

fn fetch_limits(dir: &Path, now: i64) -> Result<Limits, FetchError> {
    let creds: Value = fs::read(dir.join(".credentials.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or_else(|| FetchError::new(NO_LOGIN))?;
    let oauth = &creds["claudeAiOauth"];
    let token = oauth["accessToken"]
        .as_str()
        .filter(|t| !t.is_empty())
        .ok_or_else(|| FetchError::new(NO_LOGIN))?;
    if oauth["expiresAt"].as_i64().is_some_and(|at| at <= now) {
        return Err(FetchError::new(EXPIRED));
    }
    let auth = format!("Bearer {token}");
    let res = http::request(
        "GET",
        USAGE_URL,
        &[
            ("Authorization", auth.as_str()),
            ("anthropic-beta", "oauth-2025-04-20"),
            ("Accept", "application/json"),
        ],
        None,
    )
    .map_err(|_| FetchError::new("Claude'a ulaşılamadı (bağlantı yok?)."))?;
    match res.status {
        200 => {}
        401 | 403 => return Err(FetchError::new(EXPIRED)),
        429 => {
            return Err(FetchError {
                message: "Claude sık soruldu; birkaç dakika sonra yeniden denenecek.".into(),
                rate_limited: true,
            });
        }
        s => {
            return Err(FetchError::new(&format!(
                "Claude yanıt vermedi (HTTP {s})."
            )));
        }
    }
    serde_json::from_str::<Value>(&res.body)
        .ok()
        .and_then(|v| parse_limits(&v, now))
        .ok_or_else(|| FetchError::new("Claude'un yanıtı tanınmadı (biçim değişmiş olabilir)."))
}

/// `/api/oauth/usage` yanıtı → limitler. Önce `limits` dizisi, yoksa eski
/// `five_hour` / `seven_day` alanları.
fn parse_limits(v: &Value, now: i64) -> Option<Limits> {
    let mut out = Limits {
        session: None,
        weekly: None,
        other: Vec::new(),
        fetched_at: now,
    };
    for item in v["limits"].as_array().into_iter().flatten() {
        let (Some(kind), Some(percent)) = (item["kind"].as_str(), item["percent"].as_f64()) else {
            continue;
        };
        let limit = Limit {
            label: limit_label(kind, &item["scope"]),
            percent,
            resets_at: item["resets_at"].as_str().and_then(parse_time),
            warning: item["severity"].as_str().is_some_and(|s| s != "normal"),
        };
        match kind {
            "session" => out.session = Some(limit),
            "weekly_all" => out.weekly = Some(limit),
            _ => out.other.push(limit),
        }
    }
    let window = |w: &Value, label: &str| {
        let percent = w["utilization"].as_f64()?;
        Some(Limit {
            label: label.to_string(),
            percent,
            resets_at: w["resets_at"].as_str().and_then(parse_time),
            warning: percent >= 80.0,
        })
    };
    if out.session.is_none() {
        out.session = window(&v["five_hour"], "Oturum");
    }
    if out.weekly.is_none() {
        out.weekly = window(&v["seven_day"], "Haftalık");
    }
    (out.session.is_some() || out.weekly.is_some()).then_some(out)
}

/// "session" → "Oturum"; "weekly_opus" → "Opus · haftalık".
fn limit_label(kind: &str, scope: &Value) -> String {
    match kind {
        "session" => return "Oturum".into(),
        "weekly_all" => return "Haftalık".into(),
        _ => {}
    }
    let (name, weekly) = match kind.strip_prefix("weekly_") {
        Some(rest) => (rest, true),
        None => (kind, false),
    };
    let mut name = scope
        .as_str()
        .unwrap_or(name)
        .replace('_', " ")
        .trim()
        .to_string();
    if let Some(first) = name.get_mut(..1) {
        first.make_ascii_uppercase();
    }
    if weekly {
        format!("{name} · haftalık")
    } else {
        name
    }
}

// --- olaylar ------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct Event {
    at: i64,
    model: String,
    usd: f64,
    tokens: Tokens,
}

#[derive(Default)]
struct FileState {
    offset: u64,
}

#[derive(Default)]
struct Scanner {
    files: HashMap<PathBuf, FileState>,
    events: Vec<Event>,
    /// message.id → `events` içindeki yeri (aynı yanıtın tekrar satırları).
    seen: HashMap<String, usize>,
}

impl Scanner {
    fn scan(&mut self, root: &Path, now: i64) {
        let mut paths = Vec::new();
        collect(root, &mut paths, 0);
        for path in paths {
            let recent = fs::metadata(&path)
                .and_then(|m| m.modified())
                .map(|t| to_ms(t) > now - KEEP_MS)
                .unwrap_or(false);
            if recent {
                self.read_file(&path);
            }
        }
        self.prune(now);
    }

    /// Dosyanın yeni kısmını okur; yarım kalan son satır bir sonraki sefere.
    fn read_file(&mut self, path: &Path) {
        let Ok(mut file) = File::open(path) else {
            return;
        };
        let len = file.metadata().map(|m| m.len()).unwrap_or(0);
        let mut offset = self.files.get(path).map(|s| s.offset).unwrap_or(0);
        if len < offset {
            offset = 0; // dosya kısaldı (yeniden yazıldı)
        }
        let mut found = Vec::new();
        while offset < len {
            if file.seek(SeekFrom::Start(offset)).is_err() {
                break;
            }
            let want = ((len - offset) as usize).min(CHUNK);
            let mut buf = vec![0u8; want];
            let Ok(n) = file.read(&mut buf) else { break };
            if n == 0 {
                break;
            }
            buf.truncate(n);
            // Yalnızca tamamlanmış satırlar.
            match buf.iter().rposition(|&b| b == b'\n') {
                Some(end) => {
                    found.extend(buf[..end].split(|&b| b == b'\n').filter_map(parse_line));
                    offset += end as u64 + 1;
                }
                // Parçadan uzun tek satır (çok büyük bir araç sonucu): atla.
                None if n == CHUNK => offset += n as u64,
                None => break,
            }
        }
        self.files.entry(path.to_path_buf()).or_default().offset = offset;
        for (id, event) in found {
            self.add(id, event);
        }
    }

    fn add(&mut self, id: String, event: Event) {
        match self.seen.get(&id) {
            // Aynı yanıtın sonraki satırı: çıktısı daha büyükse (akış sonu) onu tut.
            Some(&i) => {
                if event.tokens.output > self.events[i].tokens.output {
                    // Zaman ilk satırınki kalır (isteğin başı).
                    let at = self.events[i].at;
                    self.events[i] = Event { at, ..event };
                }
            }
            None => {
                self.seen.insert(id, self.events.len());
                self.events.push(event);
            }
        }
    }

    fn prune(&mut self, now: i64) {
        let cutoff = now - KEEP_MS;
        if self.events.iter().all(|e| e.at >= cutoff) {
            return;
        }
        let keep: Vec<bool> = self.events.iter().map(|e| e.at >= cutoff).collect();
        let mut remap = vec![usize::MAX; self.events.len()];
        let mut next = 0;
        for (i, k) in keep.iter().enumerate() {
            if *k {
                remap[i] = next;
                next += 1;
            }
        }
        let mut i = 0;
        self.events.retain(|_| {
            let k = keep[i];
            i += 1;
            k
        });
        self.seen.retain(|_, idx| {
            *idx = remap[*idx];
            *idx != usize::MAX
        });
    }

    fn summary(&self, now: i64) -> Activity {
        summarize(&self.events, now)
    }
}

/// Alt klasörler dahil `.jsonl` dosyaları (alt ajan kayıtları da sayılır).
fn collect(dir: &Path, out: &mut Vec<PathBuf>, depth: u32) {
    if depth > 4 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(t) if t.is_dir() => collect(&path, out, depth + 1),
            Ok(t) if t.is_file() && path.extension().is_some_and(|e| e == "jsonl") => {
                out.push(path)
            }
            _ => {}
        }
    }
}

/// Bir kayıt satırı → (message.id, olay). Kullanım taşımayan satırlar `None`.
fn parse_line(line: &[u8]) -> Option<(String, Event)> {
    // Ucuz ön eleme: JSON ayrıştırması yalnızca kullanım içeren satırlara.
    if !contains(line, b"\"usage\"") || !contains(line, b"\"assistant\"") {
        return None;
    }
    let v: Value = serde_json::from_slice(line).ok()?;
    if v["type"] != "assistant" {
        return None;
    }
    let msg = &v["message"];
    let id = msg["id"].as_str()?.to_string();
    let model = msg["model"].as_str()?;
    if model.starts_with('<') {
        return None; // "<synthetic>": istek değil
    }
    let at = parse_time(v["timestamp"].as_str()?)?;
    let u = &msg["usage"];
    let n = |k: &str| u[k].as_u64().unwrap_or(0);
    let tokens = Tokens {
        input: n("input_tokens"),
        output: n("output_tokens"),
        cache_read: n("cache_read_input_tokens"),
        cache_write: n("cache_creation_input_tokens"),
    };
    let write_1h = u["cache_creation"]["ephemeral_1h_input_tokens"]
        .as_u64()
        .unwrap_or(0)
        .min(tokens.cache_write);
    let fast = u["speed"] == "fast";
    let usd = cost(model, &tokens, write_1h, fast);
    Some((
        id,
        Event {
            at,
            model: model.to_string(),
            usd,
            tokens,
        },
    ))
}

fn contains(hay: &[u8], needle: &[u8]) -> bool {
    hay.windows(needle.len()).any(|w| w == needle)
}

// --- fiyat ---------------------------------------------------------------------------

/// (girdi, çıktı, önbellekten okuma) $ / milyon token — API liste fiyatı
/// (claude-api referansı, 2026-11-03). Önbelleğe yazma: 5 dk 1,25×, 1 sa 2× girdi.
fn prices(model: &str) -> (f64, f64, f64) {
    let m = model.to_lowercase();
    let has = |s: &str| m.contains(s);
    if has("fable-5-2") || has("mythos-5-2") {
        (8.0, 40.0, 0.20)
    } else if has("fable") || has("mythos") {
        (10.0, 50.0, 1.0)
    } else if has("opus-5-5") {
        (4.0, 20.0, 0.20)
    } else if has("opus") {
        (5.0, 25.0, 0.50)
    } else if has("sonnet-5-5") {
        (2.0, 10.0, 0.10)
    } else if has("sonnet-5") {
        (2.0, 10.0, 0.20)
    } else if has("sonnet") {
        (3.0, 15.0, 0.30)
    } else if has("haiku-5-5") {
        (0.10, 0.50, 0.01)
    } else if has("haiku") {
        (1.0, 5.0, 0.10)
    } else {
        (4.0, 20.0, 0.20) // bilinmeyen: varsayılan model (Opus 5.5)
    }
}

fn cost(model: &str, t: &Tokens, write_1h: u64, fast: bool) -> f64 {
    let (input, output, read) = prices(model);
    let write_5m = t.cache_write - write_1h;
    let usd = (t.input as f64 * input
        + t.output as f64 * output
        + t.cache_read as f64 * read
        + write_5m as f64 * input * 1.25
        + write_1h as f64 * input * 2.0)
        / 1_000_000.0;
    // Hızlı mod 2× fiyat (Opus 5.5 / Fable 5.2).
    if fast { usd * 2.0 } else { usd }
}

/// "claude-opus-5-5" → "Opus 5.5".
fn display_name(model: &str) -> String {
    let rest = model.strip_prefix("claude-").unwrap_or(model);
    let mut parts = rest.split('-');
    let Some(family) = parts.next() else {
        return model.to_string();
    };
    let version: Vec<&str> = parts
        .take_while(|p| p.len() <= 2 && p.chars().all(|c| c.is_ascii_digit()))
        .collect();
    let mut name = family.to_string();
    if let Some(first) = name.get_mut(..1) {
        first.make_ascii_uppercase();
    }
    if version.is_empty() {
        name
    } else {
        format!("{name} {}", version.join("."))
    }
}

// --- özet ------------------------------------------------------------------------------

fn summarize(events: &[Event], now: i64) -> Activity {
    let recent: Vec<&Event> = events
        .iter()
        .filter(|e| e.at <= now + 60_000 && e.at >= now - KEEP_MS)
        .collect();

    let week: Vec<&&Event> = recent.iter().filter(|e| e.at >= now - WEEK_MS).collect();
    let mut models: HashMap<String, (f64, u32)> = HashMap::new();
    let mut tokens = Tokens::default();
    for e in &week {
        let m = models.entry(display_name(&e.model)).or_default();
        m.0 += e.usd;
        m.1 += 1;
        tokens.input += e.tokens.input;
        tokens.output += e.tokens.output;
        tokens.cache_read += e.tokens.cache_read;
        tokens.cache_write += e.tokens.cache_write;
    }
    let total: f64 = models.values().map(|m| m.0).sum();
    let mut models: Vec<ModelUsage> = models
        .into_iter()
        .map(|(name, (usd, requests))| ModelUsage {
            name,
            share: if total > 0.0 {
                (usd / total * 1000.0).round() / 10.0
            } else {
                0.0
            },
            requests,
        })
        .collect();
    models.sort_by(|a, b| {
        b.share
            .total_cmp(&a.share)
            .then(b.requests.cmp(&a.requests))
    });

    let mut hours: HashMap<i64, f64> = HashMap::new();
    for e in &recent {
        *hours.entry(e.at - e.at.rem_euclid(HOUR_MS)).or_default() += e.usd;
    }
    // Kuruş hassasiyeti (gereksiz olay yayımını da önler).
    let mut hourly: Vec<(i64, f64)> = hours
        .into_iter()
        .map(|(h, u)| (h, (u * 100.0).round() / 100.0))
        .collect();
    hourly.sort_by_key(|h| h.0);

    Activity {
        hourly,
        models,
        tokens,
        requests: week.len() as u32,
    }
}

// --- zaman -------------------------------------------------------------------------------

fn now_ms() -> i64 {
    to_ms(SystemTime::now())
}

fn to_ms(t: SystemTime) -> i64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// "2026-11-16T10:20:26.888Z" / "2026-11-17T19:30:00.836626+00:00" → epoch ms.
fn parse_time(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[10] != b'T' {
        return None;
    }
    let num = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, mi, sec) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let rest = &s[19..];
    let ms = match rest.strip_prefix('.') {
        Some(frac) => {
            let digits: String = frac.chars().take_while(char::is_ascii_digit).collect();
            format!("{digits:0<3}").get(..3)?.parse::<i64>().ok()?
        }
        None => 0,
    };
    // Saat dilimi: "+03:00" / "-05:00"; yoksa ya da "Z" ise UTC.
    let offset_min = match rest.find(['+', '-']) {
        Some(i) => {
            let tz = &rest[i..];
            let sign = if tz.starts_with('-') { -1 } else { 1 };
            let oh = tz.get(1..3)?.parse::<i64>().ok()?;
            let om = tz
                .get(4..6)
                .and_then(|m| m.parse::<i64>().ok())
                .unwrap_or(0);
            sign * (oh * 60 + om)
        }
        None => 0,
    };
    // Gün sayısı (Howard Hinnant, days_from_civil).
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * (if mo > 2 { mo - 3 } else { mo + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 24 + h) * 60 + mi - offset_min) * 60_000 + sec * 1000 + ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(id: &str, ts: &str, model: &str, output: u64) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"{ts}","message":{{"id":"{id}","model":"{model}","usage":{{"input_tokens":1000,"output_tokens":{output},"cache_read_input_tokens":1000000,"cache_creation_input_tokens":100000,"cache_creation":{{"ephemeral_1h_input_tokens":100000}}}}}}}}"#
        )
    }

    #[test]
    fn parses_time() {
        assert_eq!(parse_time("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(
            parse_time("2026-11-16T10:20:26.888Z"),
            Some(1_794_824_426_888)
        );
        assert_eq!(parse_time("2000-03-01T00:00:00Z"), Some(951_868_800_000));
        // Mikro saniye + saat dilimi.
        assert_eq!(
            parse_time("2026-11-16T10:20:26.888123+00:00"),
            Some(1_794_824_426_888)
        );
        assert_eq!(
            parse_time("2026-11-16T13:20:26.888+03:00"),
            Some(1_794_824_426_888)
        );
        assert_eq!(
            parse_time("2026-11-16T05:20:26.888-05:00"),
            Some(1_794_824_426_888)
        );
        assert_eq!(parse_time("bozuk"), None);
    }

    #[test]
    fn parses_limits() {
        // Gerçek yanıttan kısaltılmış (2026-11-17).
        let v: Value = serde_json::from_str(
            r#"{"five_hour":{"utilization":81.0,"resets_at":"2026-11-17T19:30:00.836626+00:00"},
                "seven_day":{"utilization":64.0,"resets_at":"2026-11-22T02:00:00.836646+00:00"},
                "seven_day_opus":null,
                "limits":[
                  {"kind":"session","group":"session","percent":81,"severity":"warning","resets_at":"2026-11-17T19:30:00.836626+00:00","scope":null,"is_active":true},
                  {"kind":"weekly_all","group":"weekly","percent":64,"severity":"normal","resets_at":"2026-11-22T02:00:00.836646+00:00","scope":null,"is_active":false},
                  {"kind":"weekly_opus","group":"weekly","percent":12,"severity":"normal","resets_at":null,"scope":null}
                ]}"#,
        )
        .unwrap();
        let l = parse_limits(&v, 7).unwrap();
        let s = l.session.unwrap();
        assert_eq!(
            (s.label.as_str(), s.percent, s.warning),
            ("Oturum", 81.0, true)
        );
        assert_eq!(s.resets_at, parse_time("2026-11-17T19:30:00.836Z"));
        let w = l.weekly.unwrap();
        assert_eq!((w.percent, w.warning), (64.0, false));
        assert_eq!(l.other.len(), 1);
        assert_eq!(l.other[0].label, "Opus · haftalık");
        assert_eq!(l.fetched_at, 7);

        // Eski biçim (dizi yok).
        let old: Value = serde_json::from_str(
            r#"{"five_hour":{"utilization":5.5,"resets_at":null},"seven_day":null}"#,
        )
        .unwrap();
        let l = parse_limits(&old, 0).unwrap();
        assert_eq!(l.session.unwrap().percent, 5.5);
        assert!(l.weekly.is_none());

        // Tanınmayan yanıt.
        assert!(parse_limits(&serde_json::json!({"error": "x"}), 0).is_none());
    }

    #[test]
    fn prices_and_names() {
        let t = Tokens {
            input: 1_000_000,
            output: 1_000_000,
            cache_read: 1_000_000,
            cache_write: 1_000_000,
        };
        // Opus 5.5: 4 + 20 + 0,20 + 1M yazma (yarısı 1 sa): 0,5M·5 + 0,5M·8 = 6,5
        let usd = cost("claude-opus-5-5", &t, 500_000, false);
        assert!((usd - 30.7).abs() < 1e-9, "{usd}");
        assert!((cost("claude-opus-5-5", &t, 500_000, true) - 61.4).abs() < 1e-9);
        assert_eq!(display_name("claude-opus-5-5"), "Opus 5.5");
        assert_eq!(display_name("claude-haiku-4-5-20251001"), "Haiku 4.5");
        assert_eq!(display_name("claude-fable-5"), "Fable 5");
    }

    #[test]
    fn dedupes_and_summarizes() {
        let mut s = Scanner::default();
        // Aynı yanıtın iki satırı: büyük çıktılı olan sayılır.
        for l in [
            line("a", "2026-11-17T08:00:00.000Z", "claude-opus-5-5", 10),
            line("a", "2026-11-17T08:00:01.000Z", "claude-opus-5-5", 500),
            line("b", "2026-11-17T09:00:00.000Z", "claude-sonnet-5-5", 100),
            line("c", "2026-11-17T02:00:00.000Z", "claude-opus-5-5", 100),
            // 9 gün önce: sayılmaz.
            line("d", "2026-11-08T02:00:00.000Z", "claude-opus-5-5", 100),
            r#"{"type":"user","message":{"content":"usage"}}"#.to_string(),
        ] {
            if let Some((id, e)) = parse_line(l.as_bytes()) {
                s.add(id, e);
            }
        }
        assert_eq!(s.events.len(), 4);
        let now = parse_time("2026-11-17T10:00:00.000Z").unwrap();
        let a = s.summary(now);
        assert_eq!(a.requests, 3);
        assert_eq!(a.tokens.output, 500 + 100 + 100);
        assert_eq!(a.models[0].name, "Opus 5.5");
        assert_eq!(a.models[0].requests, 2);
        let total: f64 = a.models.iter().map(|m| m.share).sum();
        assert!((total - 100.0).abs() < 0.2, "{total}");
        assert_eq!(a.hourly.len(), 3);
    }

    /// Bu makinede (yerel deneme): gerçek kayıtlar okunuyor, süre makul.
    #[test]
    #[ignore]
    fn reads_real_logs() {
        let root = claude_dir().unwrap().join("projects");
        let t = std::time::Instant::now();
        let mut s = Scanner::default();
        s.scan(&root, now_ms());
        let first = t.elapsed();
        let t2 = std::time::Instant::now();
        s.scan(&root, now_ms());
        let a = s.summary(now_ms());
        println!(
            "ilk tarama {:?}, ikinci {:?}; istek {}, modeller {:?}",
            first,
            t2.elapsed(),
            a.requests,
            a.models
                .iter()
                .map(|m| (&m.name, m.share))
                .collect::<Vec<_>>()
        );
        assert!(a.requests > 0);
    }

    /// Bu makinede (yerel deneme): limitler hesaptan alınıyor. Token yazdırılmaz.
    #[test]
    #[ignore]
    fn fetches_real_limits() {
        let l = fetch_limits(&claude_dir().unwrap(), now_ms())
            .map_err(|e| e.message)
            .unwrap();
        let show = |l: &Option<Limit>| l.as_ref().map(|l| (l.percent, l.resets_at, l.warning));
        println!(
            "oturum {:?}, hafta {:?}, diğer {}",
            show(&l.session),
            show(&l.weekly),
            l.other.len()
        );
        assert!(l.session.is_some() && l.weekly.is_some());
    }
}
