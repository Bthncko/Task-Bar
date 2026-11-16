//! Otomatik güncelleme (tauri-plugin-updater).
//!
//! Doğrulananlar (v2.tauri.app/plugin/updater, crate 2.14.1):
//! - Sürüm bilgisi GitHub Releases'teki `latest.json`'dan (tauri.conf.json →
//!   plugins.updater.endpoints); paket imzası açık anahtarla doğrulanır.
//! - Windows'ta kurulum adımında uygulama kendiliğinden kapanır ("limitation of
//!   Windows installers"); `on_before_exit` ondan hemen önce çalışır → AppBar'ı
//!   bırakıp Windows çubuğunu geri veririz (yoksa kurulum sırasında görev çubuğu
//!   gizli kalır). Kurulum `passive`: küçük ilerleme penceresi, soru yok; NSIS
//!   kurucusu bitince uygulamayı yeniden açar.
//!
//! Geliştirme derlemesinde otomatik kurulum yok (dev sürümünün üstüne yayımlanmış
//! sürüm kurulurdu); elle denetim yalnızca bilgi verir.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::config::ConfigStore;

pub const UPDATE_STATUS: &str = "update://status";
/// Açılışta ağ ve dock otursun diye ilk denetimden önce bekle.
const FIRST_CHECK: Duration = Duration::from_secs(60);
const INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Status {
    Idle,
    Checking,
    UpToDate,
    /// Yalnızca geliştirme derlemesinde: kurulmaz, bilgi verilir.
    Available {
        version: String,
    },
    Downloading {
        version: String,
        percent: u8,
    },
    Installing {
        version: String,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub status: Status,
}

pub struct Updater {
    status: Mutex<Status>,
    busy: AtomicBool,
}

impl Updater {
    pub fn new() -> Self {
        Self {
            status: Mutex::new(Status::Idle),
            busy: AtomicBool::new(false),
        }
    }

    pub fn info(&self, app: &AppHandle) -> UpdateInfo {
        UpdateInfo {
            current: app.package_info().version.to_string(),
            status: self.status.lock().unwrap().clone(),
        }
    }
}

fn set(app: &AppHandle, status: Status) {
    let updater = app.state::<Updater>();
    *updater.status.lock().unwrap() = status;
    let _ = app.emit(UPDATE_STATUS, updater.info(app));
}

/// Arka planda düzenli denetim (ayarlarda kapatılabilir).
pub fn spawn(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_CHECK);
        loop {
            if app.state::<ConfigStore>().get().auto_update {
                check_now(&app);
            }
            std::thread::sleep(INTERVAL);
        }
    });
}

/// Denetle; yeni sürüm varsa indirip kur (Windows'ta uygulama kapanıp yenisi açılır).
/// Bekleyen bir iş parçacığında çağrılmalı.
pub fn check_now(app: &AppHandle) {
    let updater = app.state::<Updater>();
    if updater.busy.swap(true, Ordering::SeqCst) {
        return;
    }
    let result = tauri::async_runtime::block_on(run(app));
    if let Err(e) = result {
        log(&format!("hata: {e}"));
        set(
            app,
            Status::Error {
                message: "Güncelleme denetlenemedi. İnternet bağlantını kontrol et.".into(),
            },
        );
    }
    updater.busy.store(false, Ordering::SeqCst);
}

async fn run(app: &AppHandle) -> tauri_plugin_updater::Result<()> {
    set(app, Status::Checking);
    let update = app
        .updater_builder()
        .on_before_exit(|| {
            log("kurulum başlıyor; uygulama kapanıyor");
            crate::win::shutdown();
        })
        .build()?
        .check()
        .await?;
    let Some(update) = update else {
        log("güncel");
        set(app, Status::UpToDate);
        return Ok(());
    };
    let version = update.version.clone();
    log(&format!("yeni sürüm: {version}"));
    if cfg!(debug_assertions) {
        set(app, Status::Available { version });
        return Ok(());
    }

    set(
        app,
        Status::Downloading {
            version: version.clone(),
            percent: 0,
        },
    );
    let mut received = 0u64;
    let mut last = 0u8;
    update
        .download_and_install(
            |chunk, total| {
                received += chunk as u64;
                if let Some(total) = total.filter(|t| *t > 0) {
                    let percent = (received * 100 / total).min(100) as u8;
                    // Her yüzde için bir olay yeter.
                    if percent != last {
                        last = percent;
                        set(
                            app,
                            Status::Downloading {
                                version: version.clone(),
                                percent,
                            },
                        );
                    }
                }
            },
            || {
                set(
                    app,
                    Status::Installing {
                        version: version.clone(),
                    },
                )
            },
        )
        .await?;
    // Windows'ta buraya gelinmez (kurucu uygulamayı kapatır); yine de.
    app.restart();
}

fn log(msg: &str) {
    if cfg!(debug_assertions) {
        eprintln!("[updater] {msg}");
    }
}
