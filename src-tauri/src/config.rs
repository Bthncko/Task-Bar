//! `%APPDATA%\com.proxd.akillidock\config.json` okuma/yazma (bölüm 7).
//!
//! Okuma/yazma yalnızca Rust'ta; her değişiklikte `config://changed` olayı tüm
//! pencerelere yeni yapılandırmanın tamamını gönderir. `#[serde(default)]`
//! sayesinde eksik alanlı eski dosyalar okunmaya devam eder.

use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::error::AppResult;

pub const CONFIG_CHANGED: &str = "config://changed";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    /// İleride göç (migration) için.
    pub version: u32,
    pub position: String,
    /// Windows görev çubuğunu gizle (bölüm 4.2). Varsayılan kapalı; tepsiden açılır.
    pub hide_windows_taskbar: bool,
    /// Küçültülen pencere dock'taki ikonuna girer, dock'tan açılınca çıkar (macOS tarzı).
    pub minimize_to_dock: bool,
    /// Yeni sürüm çıkınca kendiliğinden indirip kur (services/updater.rs).
    pub auto_update: bool,
    /// Uygulama bildirimleri sağ üstte dock tarzı kartlarla; Windows'un
    /// kutucukları kapanır (services/notifications.rs).
    pub own_notifications: bool,
    /// Otomatik gizlenme (8.10): "never" | "always" | "smart" (win/autohide.rs).
    pub auto_hide: String,
    pub theme: Theme,
    pub layout: Layout,
    pub widgets: Widgets,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: 1,
            position: "bottom".into(),
            hide_windows_taskbar: false,
            minimize_to_dock: true,
            auto_update: true,
            own_notifications: true,
            auto_hide: "never".into(),
            theme: Theme::default(),
            layout: Layout::default(),
            widgets: Widgets::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Theme {
    /// "#rrggbb" ya da "auto" (Windows vurgu rengi, 7.9).
    pub accent: String,
    pub opacity: f64,
    pub radius: f64,
    /// "wallpaper" (bulanık duvar kâğıdı camı) | "flat" (düz yarı saydam).
    pub glass: String,
    /// Tüm ölçüleri çarpar (0.85–1.25); ayrılan şerit de büyür.
    pub scale: f64,
    /// "inter" | "system" (Segoe UI).
    pub font: String,
    /// "system" (Windows'un animasyon ayarı) | "reduce" | "full".
    pub reduce_motion: String,
}

/// Ölçek ayarının sınırları (ayarlar kaydırıcısıyla aynı).
pub const SCALE_MIN: f64 = 0.85;
pub const SCALE_MAX: f64 = 1.25;

impl Theme {
    pub fn ui_scale(&self) -> f64 {
        if self.scale.is_finite() {
            self.scale.clamp(SCALE_MIN, SCALE_MAX)
        } else {
            1.0
        }
    }
}

impl Default for Theme {
    fn default() -> Self {
        Self {
            // --accent, --glass-opacity (cam katmanlarının opaklığı; ayarlarda
            // "saydamlık" olarak tersi gösterilir), --r-bar
            accent: "#3b9eff".into(),
            opacity: 0.85,
            radius: 16.0,
            glass: "wallpaper".into(),
            scale: 1.0,
            font: "inter".into(),
            reduce_motion: "system".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WidgetRef {
    pub id: String,
}

fn refs(ids: &[&str]) -> Vec<WidgetRef> {
    ids.iter()
        .map(|id| WidgetRef { id: id.to_string() })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Layout {
    pub left: Vec<WidgetRef>,
    pub center: Vec<WidgetRef>,
    pub right: Vec<WidgetRef>,
}

impl Layout {
    /// Widget üç bölümden birinde mi.
    pub fn contains(&self, id: &str) -> bool {
        [&self.left, &self.center, &self.right]
            .into_iter()
            .flatten()
            .any(|w| w.id == id)
    }
}

impl Default for Layout {
    fn default() -> Self {
        Self {
            left: refs(&["start", "apps"]),
            center: refs(&["media", "weather", "clock"]),
            right: refs(&["radios", "volume", "battery", "system"]),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Widgets {
    pub apps: AppsConfig,
    pub weather: WeatherConfig,
    pub calendar: CalendarConfig,
    pub clock: ClockConfig,
    pub system: SystemConfig,
    pub sysmon: SysmonConfig,
    pub world_clock: WorldClockConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct WorldClockConfig {
    /// Gösterilen şehirler (8.8); saat dilimi IANA adı ("Europe/London").
    pub cities: Vec<WorldCity>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorldCity {
    pub label: String,
    pub tz: String,
}

impl Default for WorldClockConfig {
    fn default() -> Self {
        let city = |label: &str, tz: &str| WorldCity {
            label: label.into(),
            tz: tz.into(),
        };
        Self {
            cities: vec![
                city("Londra", "Europe/London"),
                city("New York", "America/New_York"),
            ],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SysmonConfig {
    /// Çubuktaki görünüm: "compact", "bars" ya da "net" (8.4).
    pub view: String,
}

impl Default for SysmonConfig {
    fn default() -> Self {
        Self {
            view: "compact".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SystemConfig {
    /// Gösterilen sistem düğmeleri (8.2): "notifications", "quickSettings",
    /// "taskView", "search", "clipboard", "snip", "desktop", "tray".
    pub buttons: Vec<String>,
}

impl Default for SystemConfig {
    fn default() -> Self {
        Self {
            buttons: vec![
                "tray".into(),
                "notifications".into(),
                "quickSettings".into(),
            ],
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ClockConfig {
    /// Saatin yanında soluk saniye (açıksa widget saniyede bir çizilir).
    pub show_seconds: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppsConfig {
    pub pinned: Vec<PinnedApp>,
    pub magnify: f64,
    /// İkonda bekleyince pencere önizlemesi (8.3).
    pub previews: bool,
    pub preview_delay_ms: u32,
}

impl Default for AppsConfig {
    fn default() -> Self {
        Self {
            pinned: Vec::new(),
            magnify: 1.8,
            previews: true,
            preview_delay_ms: 350,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PinnedApp {
    /// Gruplama anahtarı (AUMID ya da küçük harfli exe yolu).
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub exe: Option<String>,
    #[serde(default)]
    pub aumid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct WeatherConfig {
    pub lat: f64,
    pub lon: f64,
    pub city: String,
    /// "C" ya da "F".
    pub unit: String,
}

impl Default for WeatherConfig {
    fn default() -> Self {
        Self {
            lat: 41.01,
            lon: 28.98,
            city: "İstanbul".into(),
            unit: "C".into(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CalendarConfig {
    /// Gizli ICS adresleri: yalnızca yerel config'te durur, repoya girmez.
    pub ics_urls: Vec<String>,
}

pub struct ConfigStore {
    path: PathBuf,
    /// Açılışta config.json yoktu: bu bilgisayarda ilk çalıştırma.
    first_run: bool,
    current: Mutex<Config>,
    app: OnceLock<AppHandle>,
}

impl ConfigStore {
    pub fn load(dir: PathBuf) -> Self {
        let path = dir.join("config.json");
        let first_run = !path.exists();
        let config = match fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str(&text) {
                Ok(config) => config,
                Err(e) => {
                    // Bozuk dosya: eskisini .bak olarak sakla, varsayılana dön.
                    eprintln!("config.json okunamadı ({e}); varsayılan kullanılıyor");
                    let _ = fs::copy(&path, path.with_extension("json.bak"));
                    Config::default()
                }
            },
            Err(_) => Config::default(),
        };
        Self {
            path,
            first_run,
            current: Mutex::new(config),
            app: OnceLock::new(),
        }
    }

    /// Değişiklik olaylarını yayınlayabilmek için uygulamaya bağla.
    pub fn attach(&self, app: AppHandle) {
        let _ = self.app.set(app);
    }

    pub fn is_first_run(&self) -> bool {
        self.first_run
    }

    pub fn get(&self) -> Config {
        self.current.lock().unwrap().clone()
    }

    /// Değiştir, diske atomik yaz (geçici dosya + yeniden adlandırma) ve yayınla.
    pub fn update(&self, change: impl FnOnce(&mut Config)) -> AppResult<()> {
        let next = {
            let mut config = self.current.lock().unwrap();
            let mut next = config.clone();
            change(&mut next);
            if next == *config {
                return Ok(());
            }
            if let Some(dir) = self.path.parent() {
                fs::create_dir_all(dir)?;
            }
            let tmp = self.path.with_extension("json.tmp");
            fs::write(&tmp, serde_json::to_vec_pretty(&next)?)?;
            fs::rename(&tmp, &self.path)?;
            *config = next.clone();
            next
        };
        if let Some(app) = self.app.get() {
            let _ = app.emit(CONFIG_CHANGED, &next);
            crate::services::sync_active(app, &next);
        }
        Ok(())
    }
}
