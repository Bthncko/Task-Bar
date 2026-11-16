//! Ses: Core Audio (bölüm 6.5). Varsayılan çıkış aygıtının seviyesi ve sesi kapalı mı.
//!
//! 7.8: yoklama yerine bildirim. `IAudioEndpointVolumeCallback` seviye / sessiz
//! değişince, `IMMNotificationClient` varsayılan aygıt değişince (kulaklık
//! takılınca) servisi uyandırır. Varsayılan aygıt her okumada yeniden alınır;
//! değiştiyse seviye bildirimi yeni aygıta taşınır. Seyrek yoklama yedektir.

use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Media::Audio::Endpoints::{
    IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl,
};
use windows::Win32::Media::Audio::{
    AUDIO_VOLUME_NOTIFICATION_DATA, DEVICE_STATE, EDataFlow, ERole, IMMDevice, IMMDeviceEnumerator,
    IMMNotificationClient, IMMNotificationClient_Impl, MMDeviceEnumerator, eMultimedia, eRender,
};
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use windows::Win32::System::Com::{CLSCTX_ALL, CoCreateInstance, STGM_READ};
use windows::core::{PCWSTR, implement};

use super::runner::{self, Waker};
use crate::win::take_pwstr;

pub const AUDIO_CHANGED: &str = "audio://changed";
/// Yedek yoklama: bildirim kaçarsa.
const POLL: Duration = Duration::from_secs(15);

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

/// Seviye / sessiz değişti.
#[implement(IAudioEndpointVolumeCallback)]
struct VolumeChanged(Waker<AudioCmd>);

impl IAudioEndpointVolumeCallback_Impl for VolumeChanged_Impl {
    fn OnNotify(&self, _data: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> windows::core::Result<()> {
        self.0.wake();
        Ok(())
    }
}

/// Aygıt eklendi / çıkarıldı / varsayılan değişti.
#[implement(IMMNotificationClient)]
struct DevicesChanged(Waker<AudioCmd>);

impl IMMNotificationClient_Impl for DevicesChanged_Impl {
    fn OnDeviceStateChanged(
        &self,
        _id: &PCWSTR,
        _state: DEVICE_STATE,
    ) -> windows::core::Result<()> {
        self.0.wake();
        Ok(())
    }
    fn OnDeviceAdded(&self, _id: &PCWSTR) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnDeviceRemoved(&self, _id: &PCWSTR) -> windows::core::Result<()> {
        self.0.wake();
        Ok(())
    }
    fn OnDefaultDeviceChanged(
        &self,
        flow: EDataFlow,
        _role: ERole,
        _id: &PCWSTR,
    ) -> windows::core::Result<()> {
        if flow == eRender {
            self.0.wake();
        }
        Ok(())
    }
    fn OnPropertyValueChanged(&self, _id: &PCWSTR, key: &PROPERTYKEY) -> windows::core::Result<()> {
        // Aygıtın adı değişirse (nadir).
        if *key == PKEY_Device_FriendlyName {
            self.0.wake();
        }
        Ok(())
    }
}

/// Seviye bildiriminin bağlı olduğu aygıt.
struct Watched {
    id: String,
    volume: IAudioEndpointVolume,
}

pub fn spawn(app: &AppHandle) {
    runner::spawn(
        app,
        "audio",
        AUDIO_CHANGED,
        POLL,
        None,
        |waker: Waker<AudioCmd>| {
            let mut enumerator: Option<IMMDeviceEnumerator> = None;
            let devices: IMMNotificationClient = DevicesChanged(waker.clone()).into();
            let on_volume: IAudioEndpointVolumeCallback = VolumeChanged(waker).into();
            let mut watched: Option<Watched> = None;
            move |cmd: Option<AudioCmd>| {
                if enumerator.is_none() {
                    enumerator =
                        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.ok();
                    if let Some(e) = &enumerator
                        && let Err(err) =
                            unsafe { e.RegisterEndpointNotificationCallback(&devices) }
                    {
                        eprintln!("[audio] aygıt bildirimi kaydedilemedi: {err}");
                    }
                }
                let device = unsafe {
                    enumerator
                        .as_ref()?
                        .GetDefaultAudioEndpoint(eRender, eMultimedia)
                }
                .ok()?;
                // SAFETY: GetId dizesi CoTaskMemAlloc ile ayrılır.
                let id = unsafe { device.GetId() }
                    .map(|p| unsafe { take_pwstr(p) })
                    .unwrap_or_default();
                if watched.as_ref().map(|w| &w.id) != Some(&id) {
                    // Varsayılan aygıt değişti: seviye bildirimini yenisine taşı.
                    if let Some(old) = watched.take() {
                        let _ = unsafe { old.volume.UnregisterControlChangeNotify(&on_volume) };
                    }
                    let volume: IAudioEndpointVolume =
                        unsafe { device.Activate(CLSCTX_ALL, None) }.ok()?;
                    if let Err(err) = unsafe { volume.RegisterControlChangeNotify(&on_volume) } {
                        eprintln!("[audio] seviye bildirimi kaydedilemedi: {err}");
                    }
                    watched = Some(Watched { id, volume });
                }
                let volume = &watched.as_ref()?.volume;
                unsafe {
                    match cmd {
                        Some(AudioCmd::SetVolume(v)) => {
                            let _ = volume
                                .SetMasterVolumeLevelScalar(v.clamp(0.0, 1.0), std::ptr::null());
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
        },
    );
}

fn friendly_name(device: &IMMDevice) -> Option<String> {
    unsafe {
        let store = device.OpenPropertyStore(STGM_READ).ok()?;
        let value = store.GetValue(&PKEY_Device_FriendlyName).ok()?;
        Some(take_pwstr(PropVariantToStringAlloc(&value).ok()?))
    }
}
