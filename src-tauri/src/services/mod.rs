pub mod accent;
pub mod app_events;
pub mod apps;
pub mod audio;
pub mod audio_devices;
pub mod backdrop;
pub mod battery_settings;
pub mod icons;
pub mod ics;
pub mod jumplist;
pub mod launcher;
pub mod media;
pub mod power;
pub mod power_mode;
pub mod radios;
pub mod runner;
pub mod spotify;
pub mod sysmon;
pub mod updater;
pub mod windows_list;
pub mod wireless;

use tauri::{AppHandle, Manager};

use crate::config::Config;

/// Hangi servisin çalışacağına yerleşime ve temaya göre karar verir (8.1).
/// Yerleşimde olmayan widget'ın servisi durur, eklenince yeniden başlar.
/// Açılışta ve config her değiştiğinde (`ConfigStore::update`) çağrılır.
pub fn sync_active(app: &AppHandle, config: &Config) {
    let on = |id: &str| config.layout.contains(id);
    if let Some(s) = app.try_state::<media::MediaService>() {
        s.set_active(on("media"));
    }
    if let Some(s) = app.try_state::<audio::AudioService>() {
        s.set_active(on("volume") || on("mic"));
    }
    if let Some(s) = app.try_state::<power::PowerService>() {
        s.set_active(on("battery"));
    }
    if let Some(s) = app.try_state::<radios::RadiosService>() {
        s.set_active(on("radios"));
    }
    if let Some(s) = app.try_state::<sysmon::SysmonService>() {
        s.set_active(on("sysmon"));
    }
    // Düz zeminde duvar kâğıdı şeridi kullanılmaz.
    if let Some(s) = app.try_state::<backdrop::BackdropService>() {
        s.set_active(config.theme.glass != "flat");
    }
    // Vurgu rengi ayarlar penceresinde de gösterilir; olay güdümlü ve ucuz.
    if let Some(s) = app.try_state::<accent::AccentService>() {
        s.set_active(true);
    }
}
