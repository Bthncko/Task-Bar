//! Bildirim kartları penceresi: ana ekranın sağ üst köşesi, odak almaz.
//!
//! Sayfa kart yığınının boyunu bildirir (`layout`); pencere ona göre boyutlanır
//! ve gösterilir, kart kalmayınca gizlenir. Pencere kartlardan her yönde
//! `SHADOW_PAD` büyük (gölge).

use tauri::{AppHandle, Manager, WebviewWindow};
use windows::Win32::UI::WindowsAndMessaging::{
    HWND_TOPMOST, SW_HIDE, SW_SHOWNOACTIVATE, SWP_NOACTIVATE, SetWindowPos, ShowWindow,
};

use super::placement;
use crate::error::{AppError, AppResult};

pub const LABEL: &str = "notify";
const SHADOW_PAD: f64 = 16.0;
/// Ekran kenarından kartın kenarına (mantıksal piksel).
const MARGIN: f64 = 12.0;

fn window(app: &AppHandle) -> AppResult<WebviewWindow> {
    app.get_webview_window(LABEL)
        .ok_or_else(|| AppError::Win32("bildirim penceresi bulunamadı".into()))
}

pub fn init(app: &AppHandle) -> AppResult<()> {
    super::window_style::apply_dock_style(&window(app)?)
}

/// `width`/`height`: kart yığını (CSS piksel × sayfa zoom'u). 0 → gizle.
pub fn layout(app: &AppHandle, width: f64, height: f64) -> AppResult<()> {
    let hwnd = window(app)?.hwnd()?;
    if height <= 0.0 {
        unsafe {
            let _ = ShowWindow(hwnd, SW_HIDE);
        }
        return Ok(());
    }
    let scale = placement::scale(hwnd);
    let monitor = placement::primary_monitor_rect();
    let pad = (SHADOW_PAD * scale).round() as i32;
    let margin = (MARGIN * scale).round() as i32;
    let w = (width * scale).round() as i32 + 2 * pad;
    let h = (height * scale).round() as i32 + 2 * pad;
    let x = monitor.right - margin + pad - w;
    let y = monitor.top + margin - pad;
    unsafe {
        SetWindowPos(hwnd, Some(HWND_TOPMOST), x, y, w, h, SWP_NOACTIVATE)?;
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
    Ok(())
}
