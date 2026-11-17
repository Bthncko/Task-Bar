//! Pencere önizlemesi (8.3): dock'taki ikonun üzerinde bekleyince pencerelerin
//! canlı küçük resimleri.
//!
//! `preview` penceresi (dock gibi odak almaz) kartları HTML ile çizer; her
//! kartın küçük resim alanını DWM doldurur (`DwmRegisterThumbnail`, hedef bu
//! pencere). Kartlar ve küçük resimler aynı pencerede: pencere taşınınca
//! küçük resimler de birlikte gelir.
//!
//! Akış (eski içerik bir kare bile görünmesin diye popup'taki gibi):
//! 1. Dock: imleç ikona girdi → `enter`. Önizleme kapalıysa gecikme
//!    (`previewDelayMs`) sonra, açıksa hemen `preview://open` gider.
//! 2. Sayfa pencerelerin kaynak boyutlarını ister (`sizes`: küçük resimler
//!    burada görünmez olarak kaydedilir), kartları dizer.
//! 3. `layout`: pencere konumlanır, küçük resimler kart alanlarına yerleşip
//!    görünür olur, pencere gösterilir. Kaydırma / liste değişiminde yeniden.
//!
//! Kapanma: imleç ikondan ve önizlemeden çıktıktan `CLOSE_GRACE` sonra (ikon →
//! önizleme geçişi kapatmasın), karta tıklayınca, panel açılınca. Kapanışta
//! tüm küçük resimler bırakılır.
//!
//! Denendi (bu makinede, 7. aşama): küçültülmüş pencerenin küçük resmi son
//! görüntüsüyle tam boyutlu gelir. Boyutu 0 gelirse sayfa ikon gösterir.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{
    DWM_THUMBNAIL_PROPERTIES, DWM_TNP_OPACITY, DWM_TNP_RECTDESTINATION, DWM_TNP_RECTSOURCE,
    DWM_TNP_SOURCECLIENTAREAONLY, DWM_TNP_VISIBLE, DwmQueryThumbnailSourceSize,
    DwmRegisterThumbnail, DwmUnregisterThumbnail, DwmUpdateThumbnailProperties,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowRect, HWND_TOPMOST, IsWindow, SW_HIDE, SW_SHOWNOACTIVATE, SWP_NOACTIVATE,
    SetWindowPos, ShowWindow,
};

use super::placement::{self, EDGE, Edge};
use super::id_to_hwnd;
use crate::config::ConfigStore;
use crate::error::{AppError, AppResult};

pub const LABEL: &str = "preview";
const OPEN_EVENT: &str = "preview://open";
/// Sayfa kartları boşaltır (bir sonraki açılışta eski kartlar görünmesin).
const CLOSED_EVENT: &str = "preview://closed";
/// Tüm pencerelere: önizlemesi açık uygulama (`null`: kapalı). Dock isim
/// balonunu bununla gizler.
pub const STATE_EVENT: &str = "preview://state";
/// İkondan önizlemeye geçerken kapanmama payı.
const CLOSE_GRACE: Duration = Duration::from_millis(200);
/// Gölge payı (PreviewWindow.module.css ile aynı) ve popup'taki aralıklar.
const SHADOW_PAD: f64 = 16.0;
const GAP: f64 = 10.0;
const MARGIN: f64 = 8.0;

/// İkonun dock penceresindeki yatay konumu (CSS piksel).
#[derive(Deserialize, Clone, Copy)]
pub struct Anchor {
    x: f64,
    width: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OpenPayload {
    app_id: String,
    seq: u64,
}

/// Bir kartın küçük resim alanı ve görünür bölge (önizleme penceresinde CSS piksel).
#[derive(Deserialize)]
pub struct ThumbRect {
    hwnd: isize,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize, Clone, Copy)]
pub struct Clip {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Kaynak pencerenin küçük resim boyutu (fiziksel piksel).
#[derive(Serialize, Clone, Copy)]
pub struct SourceSize {
    hwnd: isize,
    width: i32,
    height: i32,
}

struct Thumb {
    handle: isize,
    size: (i32, i32),
}

struct State {
    /// Her açılışta / uygulama değişiminde artar; eski istekler yok sayılır.
    seq: u64,
    /// Bekleyen açma / kapama zamanlayıcısı; her yeni olayda artar (öncekini iptal eder).
    token: u64,
    app_id: Option<String>,
    anchor: Option<Anchor>,
    visible: bool,
    /// İmleç önizleme penceresinin üstünde.
    inside: bool,
    /// Kaynak pencere → kayıtlı küçük resim.
    thumbs: HashMap<isize, Thumb>,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    let mut guard = STATE.lock().unwrap();
    let s = guard.get_or_insert_with(|| State {
        seq: 0,
        token: 0,
        app_id: None,
        anchor: None,
        visible: false,
        inside: false,
        thumbs: HashMap::new(),
    });
    f(s)
}

/// Penceresi `tauri.conf.json`'da; dock gibi odak almaz.
pub fn init(app: &AppHandle) -> AppResult<()> {
    super::window_style::apply_dock_style(&window(app)?)
}

/// Ayarlardan: önizleme açık mı, gecikme.
fn settings(app: &AppHandle) -> (bool, Duration) {
    let apps = app.state::<ConfigStore>().get().widgets.apps;
    (
        apps.previews,
        Duration::from_millis(u64::from(apps.preview_delay_ms.clamp(0, 2000))),
    )
}

/// İmleç bir uygulama ikonuna girdi (yalnızca açık penceresi olanlar).
pub fn enter(app: &AppHandle, app_id: String, anchor: Anchor) {
    let (enabled, delay) = settings(app);
    if !enabled || super::popup::is_open() {
        return;
    }
    let token = with(|s| {
        s.token += 1;
        if s.visible {
            // Açıkken başka ikona geçiş: gecikmesiz.
            if s.app_id.as_deref() != Some(app_id.as_str()) {
                s.seq += 1;
                s.app_id = Some(app_id.clone());
                s.anchor = Some(anchor);
                let _ = app.emit_to(
                    LABEL,
                    OPEN_EVENT,
                    OpenPayload {
                        app_id: app_id.clone(),
                        seq: s.seq,
                    },
                );
            }
            None
        } else {
            s.app_id = Some(app_id.clone());
            s.anchor = Some(anchor);
            Some(s.token)
        }
    });
    let Some(token) = token else { return };
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        with(|s| {
            if s.token != token || super::popup::is_open() {
                return;
            }
            s.seq += 1;
            let _ = app.emit_to(LABEL, OPEN_EVENT, OpenPayload { app_id, seq: s.seq });
        });
    });
}

/// İmleç ikondan ya da önizlemeden çıktı: kısa bir süre sonra kapan.
pub fn leave(app: &AppHandle) {
    let token = with(|s| {
        s.token += 1;
        s.token
    });
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(CLOSE_GRACE);
        let close = with(|s| s.token == token && !s.inside);
        if close {
            hide(&app);
        }
    });
}

/// Önizleme sayfası: imleç pencereye girdi / çıktı.
pub fn hover(app: &AppHandle, inside: bool) {
    with(|s| s.inside = inside);
    if inside {
        with(|s| s.token += 1);
    } else {
        leave(app);
    }
}

/// Küçük resimleri (görünmez olarak) kaydeder, kaynak boyutlarını döndürür.
/// Listede olmayan eski kayıtlar bırakılır. `seq` eskiyse boş döner.
pub fn sizes(app: &AppHandle, seq: u64, hwnds: Vec<isize>) -> AppResult<Vec<SourceSize>> {
    let dest = window(app)?.hwnd()?;
    Ok(with(|s| {
        if s.seq != seq {
            return Vec::new();
        }
        s.thumbs.retain(|hwnd, t| {
            let keep = hwnds.contains(hwnd);
            if !keep {
                unregister(t.handle);
            }
            keep
        });
        hwnds
            .iter()
            .map(|&hwnd| {
                let size = match s.thumbs.get(&hwnd) {
                    Some(t) => t.size,
                    None => match register(dest, hwnd) {
                        Some(t) => {
                            let size = t.size;
                            s.thumbs.insert(hwnd, t);
                            size
                        }
                        None => (0, 0),
                    },
                };
                SourceSize {
                    hwnd,
                    width: size.0,
                    height: size.1,
                }
            })
            .collect()
    }))
}

/// Sayfa kartları dizdi: pencereyi konumla, küçük resimleri yerleştir, göster.
/// `width`/`height`: panelin boyutu (CSS piksel, pencere her yönde gölge payı büyük).
pub fn layout(
    app: &AppHandle,
    seq: u64,
    width: f64,
    height: f64,
    thumbs: Vec<ThumbRect>,
    clip: Clip,
) -> AppResult<()> {
    let window = window(app)?;
    let hwnd = window.hwnd()?;
    let dock = app
        .get_webview_window("dock")
        .ok_or(AppError::NoDockWindow)?;
    let dock_hwnd = dock.hwnd()?;
    let scale = placement::scale(dock_hwnd);

    let Some((anchor, newly_shown, app_id)) = with(|s| {
        if s.seq != seq || s.app_id.is_none() {
            return None;
        }
        let first = !s.visible;
        s.visible = true;
        Some((s.anchor?, first, s.app_id.clone()))
    }) else {
        return Ok(());
    };

    let mut dock_rect = RECT::default();
    unsafe { GetWindowRect(dock_hwnd, &mut dock_rect)? };
    let bar = placement::reserved_rect().unwrap_or(dock_rect);
    let pad = (SHADOW_PAD * scale).round() as i32;
    let w = (width * scale).round() as i32 + 2 * pad;
    let h = (height * scale).round() as i32 + 2 * pad;
    let margin = (MARGIN * scale).round() as i32;
    let gap = (GAP * scale).round() as i32;
    let center = dock_rect.left + ((anchor.x + anchor.width / 2.0) * scale).round() as i32;
    let monitor = placement::monitor_rect_at(center, (bar.top + bar.bottom) / 2);
    let min_x = monitor.left + margin - pad;
    let max_x = (monitor.right - margin + pad - w).max(min_x);
    let x = (center - w / 2).clamp(min_x, max_x);
    let y = match EDGE {
        Edge::Bottom => bar.top - gap + pad - h,
        Edge::Top => bar.bottom + gap - pad,
    };

    // Önce küçük resimler (pencere gizliyken), sonra konum ve gösterme: ilk
    // karede kartlar ve resimler birlikte görünsün.
    let px = |v: f64| (v * scale).round() as i32;
    let clip = RECT {
        left: px(clip.x),
        top: px(clip.y),
        right: px(clip.x + clip.width),
        bottom: px(clip.y + clip.height),
    };
    with(|s| {
        let placed: HashMap<isize, &ThumbRect> = thumbs.iter().map(|t| (t.hwnd, t)).collect();
        for (src, t) in &s.thumbs {
            let props = match placed.get(src) {
                Some(r) => {
                    let dest = RECT {
                        left: px(r.x),
                        top: px(r.y),
                        right: px(r.x + r.width),
                        bottom: px(r.y + r.height),
                    };
                    clipped(dest, clip, t.size)
                }
                None => None,
            };
            update(t.handle, props);
        }
    });

    unsafe {
        SetWindowPos(hwnd, Some(HWND_TOPMOST), x, y, w, h, SWP_NOACTIVATE)?;
        if newly_shown {
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
    }
    if newly_shown {
        let _ = app.emit(STATE_EVENT, app_id);
    }
    Ok(())
}

/// Önizlemeyi kapatır ve tüm küçük resimleri bırakır. Açık değilse yalnızca
/// bekleyen açılışı iptal eder.
pub fn hide(app: &AppHandle) {
    let was_visible = with(|s| {
        s.token += 1;
        s.seq += 1;
        s.app_id = None;
        s.inside = false;
        for (_, t) in s.thumbs.drain() {
            unregister(t.handle);
        }
        std::mem::replace(&mut s.visible, false)
    });
    if was_visible {
        if let Ok(w) = window(app)
            && let Ok(hwnd) = w.hwnd()
        {
            unsafe {
                let _ = ShowWindow(hwnd, SW_HIDE);
            }
        }
        let _ = app.emit_to(LABEL, CLOSED_EVENT, ());
        let _ = app.emit(STATE_EVENT, None::<String>);
    }
}

/// Hedef dikdörtgeni görünür bölgeye kırpar; kaynak dikdörtgeni aynı oranda
/// küçültür (kaydırılan kartın taşan kısmı çizilmez). Hiç görünmüyorsa `None`.
fn clipped(dest: RECT, clip: RECT, size: (i32, i32)) -> Option<(RECT, RECT)> {
    let vis = RECT {
        left: dest.left.max(clip.left),
        top: dest.top.max(clip.top),
        right: dest.right.min(clip.right),
        bottom: dest.bottom.min(clip.bottom),
    };
    let (dw, dh) = (dest.right - dest.left, dest.bottom - dest.top);
    if vis.right <= vis.left || vis.bottom <= vis.top || dw <= 0 || dh <= 0 {
        return None;
    }
    let fx = |v: i32| (f64::from(v - dest.left) / f64::from(dw) * f64::from(size.0)).round() as i32;
    let fy = |v: i32| (f64::from(v - dest.top) / f64::from(dh) * f64::from(size.1)).round() as i32;
    let source = RECT {
        left: fx(vis.left),
        top: fy(vis.top),
        right: fx(vis.right),
        bottom: fy(vis.bottom),
    };
    Some((vis, source))
}

fn register(dest: HWND, src: isize) -> Option<Thumb> {
    unsafe {
        if !IsWindow(Some(id_to_hwnd(src))).as_bool() {
            return None;
        }
        let handle = DwmRegisterThumbnail(dest, id_to_hwnd(src)).ok()?;
        let size = DwmQueryThumbnailSourceSize(handle)
            .map(|s| (s.cx, s.cy))
            .unwrap_or((0, 0));
        update(handle, None);
        Some(Thumb { handle, size })
    }
}

/// `None`: gizle. Kaynağın tamamı (çerçeve dahil), Windows'un önizlemesi gibi.
fn update(handle: isize, placed: Option<(RECT, RECT)>) {
    let props = match placed {
        Some((dest, source)) => DWM_THUMBNAIL_PROPERTIES {
            dwFlags: DWM_TNP_RECTDESTINATION
                | DWM_TNP_RECTSOURCE
                | DWM_TNP_VISIBLE
                | DWM_TNP_OPACITY
                | DWM_TNP_SOURCECLIENTAREAONLY,
            rcDestination: dest,
            rcSource: source,
            opacity: 255,
            fVisible: true.into(),
            fSourceClientAreaOnly: false.into(),
        },
        None => DWM_THUMBNAIL_PROPERTIES {
            dwFlags: DWM_TNP_VISIBLE,
            fVisible: false.into(),
            ..Default::default()
        },
    };
    unsafe {
        let _ = DwmUpdateThumbnailProperties(handle, &props);
    }
}

fn unregister(handle: isize) {
    unsafe {
        let _ = DwmUnregisterThumbnail(handle);
    }
}

/// Kayıtlı küçük resim sayısı (sızıntı denetimi için günlüğe).
pub fn thumb_count() -> usize {
    with(|s| s.thumbs.len())
}

fn window(app: &AppHandle) -> AppResult<WebviewWindow> {
    app.get_webview_window(LABEL)
        .ok_or_else(|| AppError::Win32("önizleme penceresi bulunamadı".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(left: i32, top: i32, right: i32, bottom: i32) -> RECT {
        RECT {
            left,
            top,
            right,
            bottom,
        }
    }

    #[test]
    fn unclipped_uses_whole_source() {
        let (vis, src) = clipped(r(10, 10, 110, 70), r(0, 0, 500, 500), (1000, 600)).unwrap();
        assert_eq!((vis.left, vis.right), (10, 110));
        assert_eq!(
            (src.left, src.top, src.right, src.bottom),
            (0, 0, 1000, 600)
        );
    }

    #[test]
    fn half_scrolled_card_shows_right_half_of_source() {
        let (vis, src) = clipped(r(-40, 0, 60, 60), r(10, 0, 500, 500), (1000, 600)).unwrap();
        assert_eq!(vis.left, 10);
        assert_eq!((src.left, src.right), (500, 1000));
    }

    #[test]
    fn card_outside_clip_is_hidden() {
        assert!(clipped(r(600, 0, 700, 60), r(0, 0, 500, 500), (1000, 600)).is_none());
    }
}
