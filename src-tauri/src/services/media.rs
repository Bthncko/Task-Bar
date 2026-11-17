//! Müzik: WinRT `Windows.Media.Control` (bölüm 6.2).
//!
//! Spotify, tarayıcılar ve çoğu oynatıcı bu arayüzle görünür.
//!
//! 7.8: yoklama yerine olay. Yönetici `CurrentSessionChanged` / `SessionsChanged`,
//! o an izlenen oturum `MediaPropertiesChanged` / `PlaybackInfoChanged` ile
//! servisi uyandırır; oturum değişince oturum olayları yenisine taşınır.
//! Seyrek yoklama yedektir (bazı oynatıcılar olay göndermeyebilir).

use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use tauri::AppHandle;
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    CurrentSessionChangedEventArgs, GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
    MediaPropertiesChangedEventArgs, PlaybackInfoChangedEventArgs, SessionsChangedEventArgs,
};
use windows::Media::MediaPlaybackAutoRepeatMode;
use windows::Storage::Streams::{DataReader, IRandomAccessStreamReference};
use windows::core::Interface;
use windows_future::IAsyncOperation;

use super::runner::{self, Waker};

pub const MEDIA_CHANGED: &str = "media://changed";
/// Yedek yoklama: olay göndermeyen oynatıcılar için.
const POLL: Duration = Duration::from_secs(5);
/// Kapak resmi bundan büyükse alma (bayt).
const MAX_ARTWORK: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    pub title: String,
    pub artist: String,
    pub artwork: Option<String>,
    pub playing: bool,
    pub can_prev: bool,
    pub can_next: bool,
    pub source_app: String,
    /// Karıştırma açık mı; oynatıcı desteklemiyorsa yok.
    pub shuffle: Option<bool>,
    /// "off" | "track" | "list"; oynatıcı desteklemiyorsa yok.
    pub repeat: Option<&'static str>,
}

pub enum MediaCmd {
    Toggle,
    Next,
    Prev,
    Shuffle(bool),
    Repeat(MediaPlaybackAutoRepeatMode),
}

pub type MediaService = runner::ServiceHandle<Option<MediaState>, MediaCmd>;

/// Olaylarına abone olunan oturum ve abonelik jetonları.
struct Watched {
    session: Session,
    props: i64,
    playback: i64,
}

impl Watched {
    fn subscribe(session: Session, waker: &Waker<MediaCmd>) -> Option<Self> {
        let w = waker.clone();
        let props = session
            .MediaPropertiesChanged(
                &TypedEventHandler::<Session, MediaPropertiesChangedEventArgs>::new(move |_, _| {
                    w.wake();
                    Ok(())
                }),
            )
            .ok()?;
        let w = waker.clone();
        let playback = session
            .PlaybackInfoChanged(
                &TypedEventHandler::<Session, PlaybackInfoChangedEventArgs>::new(move |_, _| {
                    w.wake();
                    Ok(())
                }),
            )
            .ok()?;
        Some(Self {
            session,
            props,
            playback,
        })
    }
}

impl Drop for Watched {
    fn drop(&mut self) {
        let _ = self.session.RemoveMediaPropertiesChanged(self.props);
        let _ = self.session.RemovePlaybackInfoChanged(self.playback);
    }
}

/// Oturum yöneticisi ve olay jetonları; bırakılınca (servis durunca, 8.1) abonelikler silinir.
struct Opened {
    manager: Manager,
    current: Option<i64>,
    sessions: Option<i64>,
}

impl Drop for Opened {
    fn drop(&mut self) {
        if let Some(t) = self.current {
            let _ = self.manager.RemoveCurrentSessionChanged(t);
        }
        if let Some(t) = self.sessions {
            let _ = self.manager.RemoveSessionsChanged(t);
        }
    }
}

/// Yöneticiyi alır ve oturum listesi / geçerli oturum değişimlerine abone olur.
fn open_manager(waker: &Waker<MediaCmd>) -> Option<Opened> {
    let manager = Manager::RequestAsync().and_then(|op| op.join()).ok()?;
    let w = waker.clone();
    let current = manager
        .CurrentSessionChanged(
            &TypedEventHandler::<Manager, CurrentSessionChangedEventArgs>::new(move |_, _| {
                w.wake();
                Ok(())
            }),
        )
        .ok();
    let w = waker.clone();
    let sessions = manager
        .SessionsChanged(
            &TypedEventHandler::<Manager, SessionsChangedEventArgs>::new(move |_, _| {
                w.wake();
                Ok(())
            }),
        )
        .ok();
    Some(Opened {
        manager,
        current,
        sessions,
    })
}

pub fn spawn(app: &AppHandle) {
    let handle = app.clone();
    runner::spawn(
        app,
        "media",
        MEDIA_CHANGED,
        POLL,
        None,
        move |waker: Waker<MediaCmd>| {
            let app = handle.clone();
            let mut manager: Option<Opened> = None;
            let mut watched: Option<Watched> = None;
            // Kapak resmini parça değişmedikçe yeniden okuma.
            let mut artwork_key = String::new();
            let mut artwork: Option<String> = None;
            move |cmd: Option<MediaCmd>| {
                if manager.is_none() {
                    manager = open_manager(&waker);
                }
                let Some(session) = manager.as_ref()?.manager.GetCurrentSession().ok() else {
                    watched = None;
                    return None;
                };
                // Geçerli oturum değiştiyse olayları yenisine taşı (eskisi Drop ile bırakılır).
                if watched.as_ref().map(|w| w.session.as_raw()) != Some(session.as_raw()) {
                    watched = None;
                    watched = Watched::subscribe(session.clone(), &waker);
                }
                if let Some(cmd) = cmd {
                    run_command(&session, cmd);
                }
                let props = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
                let title = props.Title().map(|s| s.to_string()).unwrap_or_default();
                if title.is_empty() {
                    return None;
                }
                let artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();
                let source_app = session
                    .SourceAppUserModelId()
                    .map(|s| s.to_string())
                    .unwrap_or_default();

                let key = format!("{source_app}\u{1}{title}\u{1}{artist}");
                if key != artwork_key {
                    artwork = props.Thumbnail().ok().and_then(|t| read_artwork(&t));
                    artwork_key = key;
                    // Panelden sıradan kaldırılan şarkı başladıysa geç.
                    if source_app.to_lowercase().contains("spotify") {
                        super::spotify::Spotify::track_changed(&app, &title);
                    }
                }

                let playback = session.GetPlaybackInfo().ok();
                let playing = playback
                    .as_ref()
                    .and_then(|p| p.PlaybackStatus().ok())
                    .is_some_and(|s| s == PlaybackStatus::Playing);
                let controls = playback.as_ref().and_then(|p| p.Controls().ok());
                let can = |f: fn(&_) -> windows::core::Result<bool>| {
                    controls.as_ref().and_then(|c| f(c).ok()).unwrap_or(false)
                };

                // Karıştır / tekrarla: Spotify dahil çoğu oynatıcı bildiriyor
                // (bu makinede Spotify ile denendi). Kapalıysa düğme gösterilmez.
                let info = playback.as_ref();
                let shuffle = can(|c| c.IsShuffleEnabled())
                    .then(|| info.and_then(|p| p.IsShuffleActive().ok()?.Value().ok()))
                    .flatten();
                let repeat = can(|c| c.IsRepeatEnabled())
                    .then(|| info.and_then(|p| p.AutoRepeatMode().ok()?.Value().ok()))
                    .flatten()
                    .map(|m| match m {
                        MediaPlaybackAutoRepeatMode::Track => "track",
                        MediaPlaybackAutoRepeatMode::List => "list",
                        _ => "off",
                    });

                Some(MediaState {
                    title,
                    artist,
                    artwork: artwork.clone(),
                    playing,
                    can_prev: can(|c| c.IsPreviousEnabled()),
                    can_next: can(|c| c.IsNextEnabled()),
                    source_app,
                    shuffle,
                    repeat,
                })
            }
        },
    );
}

fn run_command(session: &Session, cmd: MediaCmd) {
    let op = match cmd {
        MediaCmd::Toggle => session.TryTogglePlayPauseAsync(),
        MediaCmd::Next => session.TrySkipNextAsync(),
        MediaCmd::Prev => session.TrySkipPreviousAsync(),
        MediaCmd::Shuffle(on) => session.TryChangeShuffleActiveAsync(on),
        MediaCmd::Repeat(mode) => session.TryChangeAutoRepeatModeAsync(mode),
    };
    let _ = op.and_then(|op| op.join());
    // Oynatıcının durumunu güncellemesine kısa süre tanı.
    std::thread::sleep(Duration::from_millis(150));
}

/// Kapak akışını baytlara çevirip data URL yapar.
fn read_artwork(reference: &IRandomAccessStreamReference) -> Option<String> {
    let stream = reference.OpenReadAsync().ok()?.join().ok()?;
    let size = stream.Size().ok()?;
    if size == 0 || size > MAX_ARTWORK {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    let load: IAsyncOperation<u32> = reader.LoadAsync(size as u32).ok()?.cast().ok()?;
    load.join().ok()?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    let content_type = stream
        .ContentType()
        .map(|s| s.to_string())
        .ok()
        .filter(|s| s.starts_with("image/"))
        .unwrap_or_else(|| "image/png".into());
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{content_type};base64,{b64}"))
}
