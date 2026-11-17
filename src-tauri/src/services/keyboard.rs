//! Klavye düzeni (8.8): ön plandaki pencerenin giriş dili ("TR", "EN").
//!
//! Düzen iş parçacığı başına (`GetKeyboardLayout`); değişince Windows olay
//! vermiyor, bu yüzden widget açıkken kısa aralıkla okunur (ucuz bir çağrı).

use std::time::Duration;

use serde::Serialize;
use windows::Win32::Globalization::{
    GetLocaleInfoEx, LCIDToLocaleName, LOCALE_SLOCALIZEDDISPLAYNAME,
};
use windows::Win32::UI::Input::KeyboardAndMouse::GetKeyboardLayout;
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
use windows::core::PCWSTR;

use super::runner;

pub const KEYBOARD_CHANGED: &str = "keyboard://changed";
const POLL: Duration = Duration::from_millis(400);

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct KeyboardState {
    /// "TR", "EN" ...
    pub short: String,
    /// "Türkçe (Türkiye)".
    pub name: String,
}

pub type KeyboardService = runner::ServiceHandle<Option<KeyboardState>, ()>;

pub fn spawn(app: &tauri::AppHandle) {
    runner::spawn(app, "keyboard", KEYBOARD_CHANGED, POLL, None, |_| {
        // Bazı pencereler (konsol) düzen döndürmez: son bilinen kalır.
        let mut last: Option<KeyboardState> = None;
        move |_: Option<()>| {
            if let Some(now) = read() {
                last = Some(now);
            }
            last.clone()
        }
    });
}

fn read() -> Option<KeyboardState> {
    unsafe {
        let fg = GetForegroundWindow();
        let thread = GetWindowThreadProcessId(fg, None);
        let layout = GetKeyboardLayout(thread);
        // Alt 16 bit: giriş dili (LANGID); LCID olarak kullanılabilir.
        let lang = (layout.0 as usize & 0xFFFF) as u32;
        if lang == 0 {
            return None;
        }
        let mut buf = [0u16; 85];
        let n = LCIDToLocaleName(lang, Some(&mut buf), 0);
        if n <= 1 {
            return None;
        }
        let locale = String::from_utf16_lossy(&buf[..n as usize - 1]);
        let mut display = [0u16; 128];
        let m = GetLocaleInfoEx(
            PCWSTR(buf.as_ptr()),
            LOCALE_SLOCALIZEDDISPLAYNAME,
            Some(&mut display),
        );
        let name = if m > 1 {
            String::from_utf16_lossy(&display[..m as usize - 1])
        } else {
            locale.clone()
        };
        let short = locale.split('-').next().unwrap_or(&locale).to_uppercase();
        Some(KeyboardState { short, name })
    }
}

#[cfg(test)]
mod tests {
    /// Bu makinede (yerel deneme): ön plandaki pencerenin dili okunuyor.
    #[test]
    #[ignore]
    fn reads_layout() {
        let state = super::read();
        println!("{state:?}");
        assert!(state.is_some_and(|s| s.short.len() == 2));
    }
}
