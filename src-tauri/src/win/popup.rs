//! Popup penceresi (bölüm 3.4): takvim, hava durumu panelleri.
//!
//! Tek pencere, açılışta gizli oluşturulur; hangi widget'ın paneli
//! gösterileceğini olayla söyleriz (bellek riski, bölüm 12 #7).
//!
//! Açılış sırası, eski içerik bir kare bile görünmesin diye:
//! 1. Dock: `show_popup(widgetId, anchor)` → burada kaydedilir, popup'a
//!    `popup://open` gider.
//! 2. Popup sayfası yeni paneli çizer, boyutunu bildirir: `popup_ready`.
//! 3. Burada konumlanır, gösterilir ve odaklanır; yanıt açılış animasyonunun
//!    çıkış noktasını taşır.
//!
//! Kapanma: odak kaybı (başka yere tıklama), `Esc`, aynı widget'a ikinci tıklama.
//! Dock odak almadığı için (NOACTIVATE) dock'a tıklamak popup'ın odağını almaz;
//! bu yüzden ikinci tıklama "kapat" olarak çalışır.
//!
//! Kapanış animasyonu (7.6): Rust pencereyi doğrudan gizlemez; sayfaya
//! `popup://close` gönderir, sayfa animasyonu bitirip `hide_popup(seq)` çağırır.
//! Sayfa yanıt vermezse `CLOSE_FALLBACK` sonra yine de gizlenir.
//!
//! Gölge için pencere panelden her yönde `SHADOW_PAD` büyüktür; konum hesabı
//! panelin kendisine göre yapılır.

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
/// Rust'tan kapanma isteği (odak kaybı, ikinci tıklama): sayfa animasyonla kapatır.
const CLOSE_EVENT: &str = "popup://close";
/// Sayfa kapanış animasyonundan sonra `hide_popup` çağırmazsa.
const CLOSE_FALLBACK: Duration = Duration::from_millis(500);
/// Panelin gölgesi için pencerenin her yöndeki payı (PopupWindow.module.css ile aynı).
const SHADOW_PAD: f64 = 16.0;

/// Bar ile panel arası ve ekran kenarı payı (mantıksal piksel).
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClosePayload {
    seq: u64,
}

/// `popup_ready` yanıtı: açılış animasyonunun çıkış noktası.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Placed {
    /// Tıklanan widget'ın ortası, panelin sol kenarından (CSS px).
    origin_x: f64,
    /// Panelin arkasındaki ekranın bulanık görüntüsü (buzlu cam, `win/glass.rs`).
    backdrop: Option<String>,
    /// O görüntünün ortalama parlaklığı (0–1).
    luma: Option<f64>,
}

struct State {
    /// Açık ya da açılmakta olan panel.
    current: Option<String>,
    anchor: Option<Anchor>,
    /// Her açılışta artar; geç gelen `popup_ready` / `hide_popup` eski açılışa
    /// aitse yok sayılır.
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
    // Panel açılırken pencere önizlemesi kapanır (8.3).
    super::preview::hide(app);
    let seq = {
        let mut s = STATE.lock().unwrap();
        if s.current.as_deref() == Some(widget_id.as_str()) {
            drop(s);
            request_close(app);
            return Ok(());
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

/// Bir panel açık ya da açılmakta (önizleme bu sırada açılmaz, 8.3).
pub fn is_open() -> bool {
    STATE.lock().unwrap().current.is_some()
}

/// Popup sayfası paneli çizdi; `width`/`height` panelin mantıksal boyutu
/// (pencere her yönde `SHADOW_PAD` büyük). Gösterilmediyse `None`.
pub fn ready(app: &AppHandle, seq: u64, width: f64, height: f64) -> AppResult<Option<Placed>> {
    let anchor = {
        let s = STATE.lock().unwrap();
        if s.seq != seq || s.current.is_none() {
            return Ok(None); // bu arada kapandı ya da başka panel istendi
        }
        s.anchor
    };
    let Some(anchor) = anchor else {
        return Ok(None);
    };

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

    let pad = (SHADOW_PAD * scale).round() as i32;
    let w = (width * scale).round() as i32 + 2 * pad;
    let h = (height * scale).round() as i32 + 2 * pad;
    let margin = (MARGIN * scale).round() as i32;
    let gap = (GAP * scale).round() as i32;

    // Paneli widget'ın ortasına hizala; panel ekran dışına taşmasın (gölge taşabilir).
    let center = dock_rect.left + ((anchor.x + anchor.width / 2.0) * scale).round() as i32;
    // Widget'ın bulunduğu monitör (8.1; şimdilik dock yalnızca birincilde).
    let monitor = placement::monitor_rect_at(center, (bar.top + bar.bottom) / 2);
    let min_x = monitor.left + margin - pad;
    let max_x = (monitor.right - margin + pad - w).max(min_x);
    let x = (center - w / 2).clamp(min_x, max_x);
    let y = match EDGE {
        Edge::Bottom => bar.top - gap + pad - h,
        Edge::Top => bar.bottom + gap - pad,
    };

    // Buzlu cam: panelin geleceği bölge, pencere gösterilmeden önce (başka panel
    // açıksa sayfa onu zaten boşalttı; yeni panel henüz görünmez).
    let glass = super::glass::capture(x + pad, y + pad, w - 2 * pad, h - 2 * pad);

    unsafe { SetWindowPos(popup_hwnd, Some(HWND_TOPMOST), x, y, w, h, SWP_NOACTIVATE)? };
    popup.show()?;
    focus::activate(hwnd_to_id(popup_hwnd));
    Ok(Some(Placed {
        origin_x: f64::from(center - x - pad) / scale,
        luma: glass.as_ref().map(|g| g.luma),
        backdrop: glass.map(|g| g.image),
    }))
}

/// Sayfa kapanış animasyonunu bitirdi (ya da `Esc` / paneldeki bir eylem).
/// `seq` eski bir açılışa aitse (bu arada başka panel açıldı) yok sayılır.
pub fn hide(app: &AppHandle, seq: Option<u64>) -> AppResult<()> {
    {
        let mut s = STATE.lock().unwrap();
        if seq.is_some_and(|q| q != s.seq) {
            return Ok(());
        }
        s.current = None;
    }
    window(app)?.hide()?;
    app.emit_to(LABEL, CLOSED_EVENT, ())?;
    super::autohide::poke();
    Ok(())
}

/// Sayfadan animasyonla kapanmasını iste; yanıt gelmezse yine de gizle.
fn request_close(app: &AppHandle) {
    let seq = {
        let mut s = STATE.lock().unwrap();
        s.current = None;
        s.seq
    };
    let _ = app.emit_to(LABEL, CLOSE_EVENT, ClosePayload { seq });
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(CLOSE_FALLBACK);
        // Bu arada yeni panel açıldıysa (seq değişti) dokunma.
        let stale = {
            let s = STATE.lock().unwrap();
            s.seq == seq && s.current.is_none()
        };
        if stale
            && let Ok(popup) = window(&app)
            && popup.is_visible().unwrap_or(false)
        {
            let _ = hide(&app, Some(seq));
        }
    });
}

fn on_blur(app: &AppHandle) {
    {
        let mut s = STATE.lock().unwrap();
        let Some(id) = s.current.clone() else { return };
        s.closed_by_blur = Some((id, Instant::now()));
    }
    request_close(app);
}

fn window(app: &AppHandle) -> AppResult<WebviewWindow> {
    app.get_webview_window(LABEL)
        .ok_or_else(|| AppError::Win32("popup penceresi bulunamadı".into()))
}
