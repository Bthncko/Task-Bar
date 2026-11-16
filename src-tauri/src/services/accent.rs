//! Windows vurgu rengi (7.9, `theme.accent = "auto"`).
//!
//! `UISettings.GetColorValue(UIColorType::Accent)`: kullanıcının Ayarlar'da
//! seçtiği vurgu rengi (learn.microsoft.com → "Theming in Windows apps").
//! `ColorValuesChanged` servisi uyandırır; UISettings nesnesi abonelik süresince
//! canlı tutulmalı (Microsoft'un Win32 örneği de öyle yapıyor). Seyrek yoklama yedek.

use std::time::Duration;

use tauri::AppHandle;
use windows::Foundation::TypedEventHandler;
use windows::UI::ViewManagement::{UIColorType, UISettings};
use windows::core::IInspectable;

use super::runner::{self, Waker};

pub const ACCENT_CHANGED: &str = "accent://changed";
const POLL: Duration = Duration::from_secs(60);

/// "#rrggbb"; okunamazsa `None` (sayfa kendi varsayılanını kullanır).
pub type AccentService = runner::ServiceHandle<Option<String>, ()>;

pub fn spawn(app: &AppHandle) {
    runner::spawn(
        app,
        "accent",
        ACCENT_CHANGED,
        POLL,
        None,
        |waker: Waker<()>| {
            let settings = UISettings::new().ok();
            if let Some(s) = &settings {
                let _ = s.ColorValuesChanged(&TypedEventHandler::<UISettings, IInspectable>::new(
                    move |_, _| {
                        waker.wake();
                        Ok(())
                    },
                ));
            }
            move |_: Option<()>| {
                let c = settings.as_ref()?.GetColorValue(UIColorType::Accent).ok()?;
                Some(format!("#{:02x}{:02x}{:02x}", c.R, c.G, c.B))
            }
        },
    );
}
