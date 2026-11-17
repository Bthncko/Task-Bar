//! Ses: Core Audio (bölüm 6.5). Varsayılan çıkışın seviyesi ve sessiz mi;
//! 8.5'ten beri çıkış aygıtları listesi ve varsayılan mikrofon da.
//!
//! 7.8: yoklama yerine bildirim. `IAudioEndpointVolumeCallback` seviye / sessiz
//! değişince, `IMMNotificationClient` varsayılan aygıt değişince (kulaklık
//! takılınca) servisi uyandırır. Varsayılan aygıtlar her okumada yeniden
//! alınır; değiştiyse seviye bildirimi yeni aygıta taşınır. Seyrek yoklama yedektir.

use std::sync::mpsc::Sender;
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
    IMMNotificationClient, IMMNotificationClient_Impl, eCapture, eMultimedia, eRender,
};
use windows::Win32::System::Com::CLSCTX_ALL;
use windows::core::{PCWSTR, implement};

use super::audio_devices::{self, Device, device_id, friendly_name};
use super::runner::{self, Waker};

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
    /// Etkin çıkış aygıtları; varsayılan işaretli (8.5).
    pub outputs: Vec<Device>,
    /// Varsayılan mikrofon; yoksa `None`.
    pub mic: Option<MicState>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MicState {
    pub name: String,
    pub volume: u8,
    pub muted: bool,
}

pub enum AudioCmd {
    Volume(f32),
    Mute(bool),
    MicVolume(f32),
    MicMute(bool),
    /// Çıkış aygıtını varsayılan yap; sonuç yanıtla döner.
    DefaultOutput(String, Sender<Result<(), String>>),
}

pub type AudioService = runner::ServiceHandle<Option<AudioState>, AudioCmd>;

/// Seviye / sessiz değişti (çıkış ya da mikrofon).
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
        self.0.wake();
        Ok(())
    }
    fn OnDeviceRemoved(&self, _id: &PCWSTR) -> windows::core::Result<()> {
        self.0.wake();
        Ok(())
    }
    fn OnDefaultDeviceChanged(
        &self,
        _flow: EDataFlow,
        _role: ERole,
        _id: &PCWSTR,
    ) -> windows::core::Result<()> {
        self.0.wake();
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
    device: IMMDevice,
    volume: IAudioEndpointVolume,
}

/// Servisin Windows kayıtları; bırakılınca (servis durunca, 8.1) silinir.
struct Subscriptions {
    enumerator: Option<IMMDeviceEnumerator>,
    devices: IMMNotificationClient,
    on_volume: IAudioEndpointVolumeCallback,
    output: Option<Watched>,
    input: Option<Watched>,
}

impl Subscriptions {
    /// `flow` yönündeki varsayılan aygıtı izle; değiştiyse bildirimi taşı.
    /// Varsayılan yoksa (ör. mikrofon takılı değil) izleme bırakılır.
    fn follow(&mut self, flow: EDataFlow) -> Option<&Watched> {
        let enumerator = self.enumerator.as_ref()?;
        let current = unsafe { enumerator.GetDefaultAudioEndpoint(flow, eMultimedia) }.ok();
        let slot = if flow == eRender {
            &mut self.output
        } else {
            &mut self.input
        };
        let id = current.as_ref().and_then(device_id);
        if slot.as_ref().map(|w| &w.id) != id.as_ref() {
            if let Some(old) = slot.take() {
                let _ = unsafe { old.volume.UnregisterControlChangeNotify(&self.on_volume) };
            }
            if let (Some(device), Some(id)) = (current, id) {
                let volume: IAudioEndpointVolume =
                    unsafe { device.Activate(CLSCTX_ALL, None) }.ok()?;
                if let Err(err) = unsafe { volume.RegisterControlChangeNotify(&self.on_volume) } {
                    eprintln!("[audio] seviye bildirimi kaydedilemedi: {err}");
                }
                *slot = Some(Watched { id, device, volume });
            }
        }
        slot.as_ref()
    }
}

impl Drop for Subscriptions {
    fn drop(&mut self) {
        unsafe {
            for w in [self.output.take(), self.input.take()]
                .into_iter()
                .flatten()
            {
                let _ = w.volume.UnregisterControlChangeNotify(&self.on_volume);
            }
            if let Some(e) = &self.enumerator {
                let _ = e.UnregisterEndpointNotificationCallback(&self.devices);
            }
        }
    }
}

pub fn spawn(app: &AppHandle) {
    runner::spawn(
        app,
        "audio",
        AUDIO_CHANGED,
        POLL,
        None,
        |waker: Waker<AudioCmd>| {
            let mut subs = Subscriptions {
                enumerator: None,
                devices: DevicesChanged(waker.clone()).into(),
                on_volume: VolumeChanged(waker).into(),
                output: None,
                input: None,
            };
            move |cmd: Option<AudioCmd>| {
                if subs.enumerator.is_none() {
                    subs.enumerator = audio_devices::enumerator();
                    if let Some(e) = &subs.enumerator
                        && let Err(err) =
                            unsafe { e.RegisterEndpointNotificationCallback(&subs.devices) }
                    {
                        eprintln!("[audio] aygıt bildirimi kaydedilemedi: {err}");
                    }
                }
                // Varsayılanı değiştirmek önce: sonra yeni aygıt okunur.
                let cmd = match cmd {
                    Some(AudioCmd::DefaultOutput(id, reply)) => {
                        let _ =
                            reply.send(audio_devices::set_default(&id).map_err(|e| e.to_string()));
                        None
                    }
                    other => other,
                };
                apply(&mut subs, cmd);
                read(&mut subs)
            }
        },
    );
}

fn apply(subs: &mut Subscriptions, cmd: Option<AudioCmd>) {
    let Some(cmd) = cmd else { return };
    let (flow, set_level, set_mute) = match cmd {
        AudioCmd::Volume(v) => (eRender, Some(v), None),
        AudioCmd::Mute(m) => (eRender, None, Some(m)),
        AudioCmd::MicVolume(v) => (eCapture, Some(v), None),
        AudioCmd::MicMute(m) => (eCapture, None, Some(m)),
        AudioCmd::DefaultOutput(..) => return,
    };
    let Some(watched) = subs.follow(flow) else {
        return;
    };
    unsafe {
        if let Some(v) = set_level {
            let _ = watched
                .volume
                .SetMasterVolumeLevelScalar(v.clamp(0.0, 1.0), std::ptr::null());
            // Ses açılınca sessizden de çık (Windows'un kendi davranışı gibi).
            if v > 0.0 {
                let _ = watched.volume.SetMute(false, std::ptr::null());
            }
        }
        if let Some(m) = set_mute {
            let _ = watched.volume.SetMute(m, std::ptr::null());
        }
    }
}

fn level(volume: &IAudioEndpointVolume) -> Option<(u8, bool)> {
    unsafe {
        let level = volume.GetMasterVolumeLevelScalar().ok()?;
        let muted = volume.GetMute().ok()?.as_bool();
        Some(((level * 100.0).round() as u8, muted))
    }
}

fn read(subs: &mut Subscriptions) -> Option<AudioState> {
    let mic = subs.follow(eCapture).and_then(|w| {
        let (volume, muted) = level(&w.volume)?;
        Some(MicState {
            name: friendly_name(&w.device).unwrap_or_default(),
            volume,
            muted,
        })
    });
    let (volume, muted, device) = {
        let out = subs.follow(eRender)?;
        let (volume, muted) = level(&out.volume)?;
        (
            volume,
            muted,
            friendly_name(&out.device).unwrap_or_default(),
        )
    };
    let outputs = audio_devices::list(subs.enumerator.as_ref()?, eRender);
    Some(AudioState {
        volume,
        muted,
        device,
        outputs,
        mic,
    })
}
