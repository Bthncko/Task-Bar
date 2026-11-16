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
            theme: Theme::default(),
            layout: Layout::default(),
            widgets: Widgets::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Theme {
    pub accent: String,
    pub opacity: f64,
    pub radius: f64,
}

impl Default for Theme {
    fn default() -> Self {
        Self {
            accent: "#6aa8ff".into(),
            opacity: 0.6,
            radius: 14.0,
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

impl Default for Layout {
    fn default() -> Self {
        Self {
            left: refs(&["start", "apps"]),
            center: refs(&["media", "weather", "clock"]),
            right: refs(&["radios", "volume", "battery"]),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Widgets {
    pub apps: AppsConfig,
    pub weather: WeatherConfig,
    pub calendar: CalendarConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppsConfig {
    pub pinned: Vec<PinnedApp>,
    pub magnify: f64,
}

impl Default for AppsConfig {
    fn default() -> Self {
        Self {
            pinned: Vec::new(),
            magnify: 1.8,
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
    current: Mutex<Config>,
    app: OnceLock<AppHandle>,
}

impl ConfigStore {
    pub fn load(dir: PathBuf) -> Self {
        let path = dir.join("config.json");
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
            current: Mutex::new(config),
            app: OnceLock::new(),
        }
    }

    /// Değişiklik olaylarını yayınlayabilmek için uygulamaya bağla.
    pub fn attach(&self, app: AppHandle) {
        let _ = self.app.set(app);
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
        }
        Ok(())
    }
}
