//! `%APPDATA%\com.proxd.akillidock\config.json` okuma/yazma (bölüm 7).
//!
//! Aşama 2'de yalnızca sabitlenen uygulamalar burada. Tema, düzen vb. alanlar
//! Aşama 4'te eklenecek; `#[serde(default)]` sayesinde eski dosyalar okunmaya devam eder.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub version: u32,
    /// Windows görev çubuğunu gizle (bölüm 4.2). Varsayılan kapalı; tepsiden açılır.
    pub hide_windows_taskbar: bool,
    pub widgets: Widgets,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: 1,
            hide_windows_taskbar: false,
            widgets: Widgets::default(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Widgets {
    pub apps: AppsConfig,
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

pub struct ConfigStore {
    path: PathBuf,
    current: Mutex<Config>,
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
        }
    }

    pub fn get(&self) -> Config {
        self.current.lock().unwrap().clone()
    }

    /// Değiştir ve diske atomik yaz (geçici dosya + yeniden adlandırma).
    pub fn update(&self, change: impl FnOnce(&mut Config)) -> AppResult<()> {
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
        *config = next;
        Ok(())
    }
}
