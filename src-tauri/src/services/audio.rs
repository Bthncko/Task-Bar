//! Ses: Core Audio (bölüm 6.5). Varsayılan çıkış aygıtının seviyesi ve sesi kapalı mı.
//!
//! v1 yoklama (500 ms); varsayılan aygıt her turda yeniden alınır, böylece
//! kulaklık takılınca kendiliğinden ona geçer. Aşama 7'de geri çağrılara geçecek.

use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, eMultimedia, eRender,
};
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use windows::Win32::System::Com::{CLSCTX_ALL, CoCreateInstance, STGM_READ};

use super::runner;
use crate::win::take_pwstr;

pub const AUDIO_CHANGED: &str = "audio://changed";
const POLL: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioState {
    /// 0–100 tam sayı (gereksiz olay yağmuru olmasın).
    pub volume: u8,
    pub muted: bool,
    pub device: String,
}

pub enum AudioCmd {
    SetVolume(f32),
    SetMute(bool),
}

pub type AudioService = runner::ServiceHandle<Option<AudioState>, AudioCmd>;

pub fn spawn(app: &AppHandle) {
    runner::spawn(app, "audio", AUDIO_CHANGED, POLL, None, || {
        let mut enumerator: Option<IMMDeviceEnumerator> = None;
        move |cmd: Option<AudioCmd>| {
            if enumerator.is_none() {
                enumerator =
                    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.ok();
            }
            let device =
                unsafe { enumerator.as_ref()?.GetDefaultAudioEndpoint(eRender, eMultimedia) }
                    .ok()?;
            let volume: IAudioEndpointVolume =
                unsafe { device.Activate(CLSCTX_ALL, None) }.ok()?;
            unsafe {
                match cmd {
                    Some(AudioCmd::SetVolume(v)) => {
                        let _ = volume.SetMasterVolumeLevelScalar(v.clamp(0.0, 1.0), std::ptr::null());
                        // Ses açılınca sessizden de çık (Windows'un kendi davranışı gibi).
                        if v > 0.0 {
                            let _ = volume.SetMute(false, std::ptr::null());
                        }
                    }
                    Some(AudioCmd::SetMute(m)) => {
                        let _ = volume.SetMute(m, std::ptr::null());
                    }
                    None => {}
                }
                let level = volume.GetMasterVolumeLevelScalar().ok()?;
                let muted = volume.GetMute().ok()?.as_bool();
                Some(AudioState {
                    volume: (level * 100.0).round() as u8,
                    muted,
                    device: friendly_name(&device).unwrap_or_default(),
                })
            }
        }
    });
}

fn friendly_name(device: &IMMDevice) -> Option<String> {
    unsafe {
        let store = device.OpenPropertyStore(STGM_READ).ok()?;
        let value = store.GetValue(&PKEY_Device_FriendlyName).ok()?;
        Some(take_pwstr(PropVariantToStringAlloc(&value).ok()?))
    }
}
