//! Wi-Fi / Bluetooth: WinRT `Windows.Devices.Radios` + ağ adı (bölüm 6.7).
//!
//! Doğrulandı (bu makinede, paketsiz süreçten): radyo listesi okunuyor,
//! `RequestAccessAsync` → Allowed. Belgelere göre "radios" yeteneği gerekiyor;
//! paketsiz uygulamada buna rağmen çalıştı. Değiştirme reddedilirse frontend
//! `ms-settings:` sayfasını açar.
//!
//! Ağ adı: Microsoft'un konum izni gerektirmeyen yol olarak önerdiği
//! `WlanConnectionProfileDetails.GetConnectedSsid` (WlanQueryInterface değil).
//!
//! 7.8: yoklama yerine olay. `Radio.StateChanged` (aç/kapat, uçak modu, donanım
//! anahtarı) ve `NetworkInformation.NetworkStatusChanged` (bağlantı değişimi)
//! servisi uyandırır. Sinyal gücünün olayı yok; seyrek yoklama onu ve kaçan
//! olayları yakalar.

use std::sync::mpsc::Sender;
use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use windows::Devices::Radios::{Radio, RadioAccessStatus, RadioKind, RadioState};
use windows::Foundation::TypedEventHandler;
use windows::Networking::Connectivity::{NetworkInformation, NetworkStatusChangedEventHandler};
use windows::core::IInspectable;

use super::runner::{self, Waker};

pub const RADIOS_CHANGED: &str = "radios://changed";
/// Yedek yoklama: sinyal çubukları ve kaçan olaylar için.
const POLL: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RadioInfo {
    pub on: bool,
    /// Donanım anahtarı / ürün yazılımı kapatmış: programla açılamaz.
    pub disabled: bool,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RadiosState {
    pub wifi: Option<RadioInfo>,
    pub bluetooth: Option<RadioInfo>,
    /// Bağlı Wi-Fi ağının adı.
    pub ssid: Option<String>,
    /// 0–5 sinyal çubuğu.
    pub signal: Option<u8>,
}

pub struct SetRadio {
    pub wifi: bool,
    pub on: bool,
    pub reply: Sender<Result<(), String>>,
}

pub type RadiosService = runner::ServiceHandle<RadiosState, SetRadio>;

pub fn spawn(app: &AppHandle) {
    runner::spawn(
        app,
        "radios",
        RADIOS_CHANGED,
        POLL,
        RadiosState::default(),
        |waker: Waker<SetRadio>| {
            let mut access_requested = false;
            // Olaylarına abone olunan radyolar: nesne yaşadıkça abonelik sürer.
            let mut watched: Vec<Radio> = Vec::new();
            let w = waker.clone();
            if let Err(e) = NetworkInformation::NetworkStatusChanged(
                &NetworkStatusChangedEventHandler::new(move |_| {
                    w.wake();
                    Ok(())
                }),
            ) {
                eprintln!("[radios] ağ bildirimi kaydedilemedi: {e}");
            }
            move |cmd: Option<SetRadio>| {
                if !access_requested {
                    // Yalnızca değiştirmek için gerekir; okuma her zaman serbest.
                    let _ = Radio::RequestAccessAsync().and_then(|op| op.join());
                    access_requested = true;
                }
                if watched.is_empty() {
                    watched = subscribe(&waker);
                }
                let radios = list_radios();
                if let Some(cmd) = cmd {
                    let kind = if cmd.wifi {
                        RadioKind::WiFi
                    } else {
                        RadioKind::Bluetooth
                    };
                    let result = set_state(&radios, kind, cmd.on);
                    let _ = cmd.reply.send(result);
                    return read_state(&list_radios());
                }
                read_state(&radios)
            }
        },
    );
}

/// Her radyonun durum değişimine abone olur; abone olunanları döndürür.
fn subscribe(waker: &Waker<SetRadio>) -> Vec<Radio> {
    list_radios()
        .into_iter()
        .filter(|radio| {
            let w = waker.clone();
            radio
                .StateChanged(&TypedEventHandler::<Radio, IInspectable>::new(
                    move |_, _| {
                        w.wake();
                        Ok(())
                    },
                ))
                .is_ok()
        })
        .collect()
}

fn list_radios() -> Vec<Radio> {
    let Ok(view) = Radio::GetRadiosAsync().and_then(|op| op.join()) else {
        return Vec::new();
    };
    let count = view.Size().unwrap_or(0);
    (0..count).filter_map(|i| view.GetAt(i).ok()).collect()
}

fn info(radios: &[Radio], kind: RadioKind) -> Option<RadioInfo> {
    let radio = radios.iter().find(|r| r.Kind().ok() == Some(kind))?;
    let state = radio.State().ok()?;
    Some(RadioInfo {
        on: state == RadioState::On,
        disabled: state == RadioState::Disabled,
    })
}

fn read_state(radios: &[Radio]) -> RadiosState {
    let (ssid, signal) = wifi_connection();
    RadiosState {
        wifi: info(radios, RadioKind::WiFi),
        bluetooth: info(radios, RadioKind::Bluetooth),
        ssid,
        signal,
    }
}

fn wifi_connection() -> (Option<String>, Option<u8>) {
    let Ok(profile) = NetworkInformation::GetInternetConnectionProfile() else {
        return (None, None);
    };
    if !profile.IsWlanConnectionProfile().unwrap_or(false) {
        return (None, None);
    }
    let ssid = profile
        .WlanConnectionProfileDetails()
        .and_then(|d| d.GetConnectedSsid())
        .map(|s| s.to_string())
        .ok()
        .filter(|s| !s.is_empty());
    let signal = profile.GetSignalBars().and_then(|bars| bars.Value()).ok();
    (ssid, signal)
}

fn set_state(radios: &[Radio], kind: RadioKind, on: bool) -> Result<(), String> {
    let radio = radios
        .iter()
        .find(|r| r.Kind().ok() == Some(kind))
        .ok_or("radyo bulunamadı")?;
    let target = if on { RadioState::On } else { RadioState::Off };
    let status = radio
        .SetStateAsync(target)
        .and_then(|op| op.join())
        .map_err(|e| e.message())?;
    if status == RadioAccessStatus::Allowed {
        Ok(())
    } else {
        Err(format!("erişim reddedildi ({})", status.0))
    }
}
