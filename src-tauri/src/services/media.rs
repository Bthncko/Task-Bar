//! Müzik: WinRT `Windows.Media.Control` (bölüm 6.2).
//!
//! Spotify, tarayıcılar ve çoğu oynatıcı bu arayüzle görünür. v1 yoklama (1 sn);
//! Aşama 7'de `CurrentSessionChanged` / `MediaPropertiesChanged` olaylarına geçecek.

use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use tauri::AppHandle;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};
use windows::Storage::Streams::{DataReader, IRandomAccessStreamReference};
use windows::core::Interface;
use windows_future::IAsyncOperation;

use super::runner;

pub const MEDIA_CHANGED: &str = "media://changed";
const POLL: Duration = Duration::from_secs(1);
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
}

pub enum MediaCmd {
    Toggle,
    Next,
    Prev,
}

pub type MediaService = runner::ServiceHandle<Option<MediaState>, MediaCmd>;

pub fn spawn(app: &AppHandle) {
    runner::spawn(app, "media", MEDIA_CHANGED, POLL, None, || {
        let mut manager: Option<Manager> = None;
        // Kapak resmini parça değişmedikçe yeniden okuma.
        let mut artwork_key = String::new();
        let mut artwork: Option<String> = None;
        move |cmd: Option<MediaCmd>| {
            if manager.is_none() {
                manager = Manager::RequestAsync().and_then(|op| op.join()).ok();
            }
            let session = manager.as_ref()?.GetCurrentSession().ok()?;
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

            Some(MediaState {
                title,
                artist,
                artwork: artwork.clone(),
                playing,
                can_prev: can(|c| c.IsPreviousEnabled()),
                can_next: can(|c| c.IsNextEnabled()),
                source_app,
            })
        }
    });
}

fn run_command(session: &Session, cmd: MediaCmd) {
    let op = match cmd {
        MediaCmd::Toggle => session.TryTogglePlayPauseAsync(),
        MediaCmd::Next => session.TrySkipNextAsync(),
        MediaCmd::Prev => session.TrySkipPreviousAsync(),
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
