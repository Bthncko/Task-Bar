//! Bildirim kartları penceresi: ana ekranın sağ üst köşesi, odak almaz.
//!
//! Sayfa kart yığınının boyunu bildirir (`layout`); pencere ona göre boyutlanır
//! ve gösterilir, kart kalmayınca gizlenir. Pencere kartlardan her yönde
//! `SHADOW_PAD` büyük (gölge).
//!
//! Buzlu cam (`glass.rs`, panellerle aynı): pencere gizliyken ilk kart gelince,
//! kartların duracağı köşe (`GLASS_W` × `GLASS_H` mantıksal piksel, yığının sağ
//! üst köşesine yaslı) okunur, bulanıklaştırılır ve kart olayından önce sayfaya
//! gönderilir. Pencere görünürken yeniden okunmaz (kendi kartlarımız görünürdü);
//! yığın kapanınca bir sonraki bildirimde yenilenir.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::Win32::UI::WindowsAndMessaging::{
    HWND_TOPMOST, IsWindowVisible, SW_HIDE, SW_SHOWNOACTIVATE, SWP_NOACTIVATE, SetWindowPos,
    ShowWindow,
};

use super::placement;
use crate::error::{AppError, AppResult};

pub const LABEL: &str = "notify";
pub const NOTIFY_BACKDROP: &str = "notify://backdrop";
const SHADOW_PAD: f64 = 16.0;
/// Ekran kenarından kartın kenarına (mantıksal piksel).
const MARGIN: f64 = 12.0;
/// Okunan köşe (mantıksal piksel, sayfa zoom'u öncesi): kart (360) + pay;
/// üç kartlık yığından uzun.
const GLASS_W: f64 = 400.0;
const GLASS_H: f64 = 560.0;

#[derive(Serialize, Clone)]
pub struct Backdrop {
    /// `data:image/jpeg;base64,...`
    image: String,
    /// Ortalama parlaklık (0–1): açık zeminde örtü koyulaşır.
    luma: f64,
    /// Görüntünün kapladığı alan (sayfa CSS pikseli, zoom öncesi); sağ üst
    /// köşesi yığının sağ üst köşesi.
    width: f64,
    height: f64,
}

fn window(app: &AppHandle) -> AppResult<WebviewWindow> {
    app.get_webview_window(LABEL)
        .ok_or_else(|| AppError::Win32("bildirim penceresi bulunamadı".into()))
}

pub fn init(app: &AppHandle) -> AppResult<()> {
    super::window_style::apply_dock_style(&window(app)?)
}

/// Yeni kart gösterilmeden hemen önce (`NOTIFY_SHOW`'dan önce) çağrılır.
pub fn before_show(app: &AppHandle) {
    let Ok(hwnd) = window(app).and_then(|w| Ok(w.hwnd()?)) else {
        return;
    };
    if unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return;
    }
    let scale = placement::scale(hwnd) * placement::ui_scale();
    let monitor = placement::primary_monitor_rect();
    let dpi = placement::scale(hwnd);
    let w = (GLASS_W * scale).round() as i32;
    let h = ((GLASS_H * scale).round() as i32).min(monitor.bottom - monitor.top);
    let right = monitor.right - (MARGIN * dpi).round() as i32;
    let top = monitor.top + (MARGIN * dpi).round() as i32;
    if let Some(glass) = super::glass::capture(right - w, top, w, h) {
        let _ = app.emit_to(
            LABEL,
            NOTIFY_BACKDROP,
            Backdrop {
                image: glass.image,
                luma: glass.luma,
                width: GLASS_W,
                height: f64::from(h) / scale,
            },
        );
    }
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
