//! Popup penceresi (bölüm 3.4): takvim, hava durumu panelleri.
//!
//! Tek pencere, açılışta gizli oluşturulur; hangi widget'ın paneli
//! gösterileceğini olayla söyleriz (bellek riski, bölüm 12 #7).
//!
//! Açılış sırası, eski içerik bir kare bile görünmesin diye:
//! 1. Dock: `show_popup(widgetId, anchor)` → burada kaydedilir, popup'a
//!    `popup://open` gider.
//! 2. Popup sayfası yeni paneli çizer, boyutunu bildirir: `popup_ready`.
//! 3. Burada konumlanır, gösterilir ve odaklanır.
//!
//! Kapanma: odak kaybı (başka yere tıklama), `Esc`, aynı widget'a ikinci tıklama.
//! Dock odak almadığı için (NOACTIVATE) dock'a tıklamak popup'ın odağını almaz;
//! bu yüzden ikinci tıklama "kapat" olarak çalışır.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::Win32::Foundation::RECT;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowRect, HWND_TOPMOST, SWP_NOACTIVATE, SetWindowPos,
};

use super::placement::{self, EDGE, Edge};
use super::{focus, hwnd_to_id};
use crate::error::{AppError, AppResult};

pub const LABEL: &str = "popup";
const OPEN_EVENT: &str = "popup://open";
/// Sayfa paneli boşaltır: bir sonraki açılışta eski panelin son karesi görünmesin.
const CLOSED_EVENT: &str = "popup://closed";

/// Bar ile popup arası ve ekran kenarı payı (mantıksal piksel).
const GAP: f64 = 10.0;
const MARGIN: f64 = 8.0;
/// Odak kaybıyla kapanan popup'ın widget'ına bu süre içinde gelen tıklama
/// onu yeniden açmaz (tıklama hem odak kaybına hem de bu komuta yol açarsa).
const REOPEN_GUARD: Duration = Duration::from_millis(300);

/// Tıklanan widget'ın dock penceresindeki dikdörtgeni (CSS piksel).
#[derive(Deserialize, Clone, Copy)]
pub struct Anchor {
    x: f64,
    width: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OpenPayload {
    widget_id: String,
    seq: u64,
}

struct State {
    /// Açık ya da açılmakta olan panel.
    current: Option<String>,
    anchor: Option<Anchor>,
    /// Her açılışta artar; geç gelen `popup_ready` eski açılışa aitse yok sayılır.
    seq: u64,
    closed_by_blur: Option<(String, Instant)>,
}

static STATE: Mutex<State> = Mutex::new(State {
    current: None,
    anchor: None,
    seq: 0,
    closed_by_blur: None,
});

/// Penceresi `tauri.conf.json`'da tanımlı; stil + odak kaybı dinleyicisi.
pub fn init(app: &AppHandle) -> AppResult<()> {
    let popup = window(app)?;
    super::window_style::apply_popup_style(&popup)?;
    let handle = app.clone();
    popup.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(false) = event {
            on_blur(&handle);
        }
    });
    Ok(())
}

/// Widget tıklaması: kapalıysa aç, aynı panel açıksa kapat, başkası açıksa değiştir.
pub fn toggle(app: &AppHandle, widget_id: String, anchor: Anchor) -> AppResult<()> {
    let seq = {
        let mut s = STATE.lock().unwrap();
        if s.current.as_deref() == Some(widget_id.as_str()) {
            drop(s);
            return hide(app);
        }
        if let Some((id, at)) = s.closed_by_blur.take()
            && id == widget_id
            && at.elapsed() < REOPEN_GUARD
        {
            return Ok(());
        }
        s.seq += 1;
        s.current = Some(widget_id.clone());
        s.anchor = Some(anchor);
        s.seq
    };
    app.emit_to(LABEL, OPEN_EVENT, OpenPayload { widget_id, seq })?;
    Ok(())
}

/// Popup sayfası paneli çizdi; `width`/`height` mantıksal piksel.
pub fn ready(app: &AppHandle, seq: u64, width: f64, height: f64) -> AppResult<()> {
    let anchor = {
        let s = STATE.lock().unwrap();
        if s.seq != seq || s.current.is_none() {
            return Ok(()); // bu arada kapandı ya da başka panel istendi
        }
        s.anchor
    };
    let Some(anchor) = anchor else { return Ok(()) };

    let popup = window(app)?;
    let dock = app
        .get_webview_window("dock")
        .ok_or(AppError::NoDockWindow)?;
    let dock_hwnd = dock.hwnd()?;
    let popup_hwnd = popup.hwnd()?;
    let scale = placement::scale(dock_hwnd);

    let mut dock_rect = RECT::default();
    unsafe { GetWindowRect(dock_hwnd, &mut dock_rect)? };
    let bar = placement::reserved_rect().unwrap_or(dock_rect);
    let monitor = placement::primary_monitor_rect();

    let w = (width * scale).round() as i32;
    let h = (height * scale).round() as i32;
    let margin = (MARGIN * scale).round() as i32;
    let gap = (GAP * scale).round() as i32;

    // Widget'ın ortasına hizala, ekran dışına taşırma.
    let center = dock_rect.left + ((anchor.x + anchor.width / 2.0) * scale).round() as i32;
    let max_x = (monitor.right - margin - w).max(monitor.left + margin);
    let x = (center - w / 2).clamp(monitor.left + margin, max_x);
    let y = match EDGE {
        Edge::Bottom => bar.top - gap - h,
        Edge::Top => bar.bottom + gap,
    };

    unsafe { SetWindowPos(popup_hwnd, Some(HWND_TOPMOST), x, y, w, h, SWP_NOACTIVATE)? };
    popup.show()?;
    focus::activate(hwnd_to_id(popup_hwnd));
    Ok(())
}

/// `Esc`, ikinci tıklama ya da paneldeki bir eylemden sonra.
pub fn hide(app: &AppHandle) -> AppResult<()> {
    STATE.lock().unwrap().current = None;
    window(app)?.hide()?;
    app.emit_to(LABEL, CLOSED_EVENT, ())?;
    Ok(())
}

fn on_blur(app: &AppHandle) {
    {
        let mut s = STATE.lock().unwrap();
        let Some(id) = s.current.take() else { return };
        s.closed_by_blur = Some((id, Instant::now()));
    }
    if let Ok(popup) = window(app) {
        let _ = popup.hide();
    }
    let _ = app.emit_to(LABEL, CLOSED_EVENT, ());
}

fn window(app: &AppHandle) -> AppResult<WebviewWindow> {
    app.get_webview_window(LABEL)
        .ok_or_else(|| AppError::Win32("popup penceresi bulunamadı".into()))
}
