//! macOS tarzı küçültme / geri yükleme: pencere dock'taki ikonuna girer ve çıkar.
//!
//! Windows başka uygulamaların pencerelerini kendisi canlandırır; biz yalnızca
//! üstüne kendi animasyonumuzu çizebiliriz:
//! - DWM küçük resmi (`DwmRegisterThumbnail`): pencerenin canlı görüntüsünü
//!   kendi saydam katman penceremizde çizer; hedef dikdörtgeni her karede
//!   (`DwmFlush` = ekran yenilemesi) pencere ↔ ikon arasında değiştiririz.
//!   Yalnızca dikdörtgen ölçekleme var: macOS'un "Ölçekle" efekti, "cin" bükülmesi yok.
//! - Windows'un kendi geçişleri, dock'taki uygulama pencerelerinde kapatılır
//!   (`DWMWA_TRANSITIONS_FORCEDISABLED`), yoksa iki animasyon üst üste oynar.
//!   Dock kapanırken / ayar kapatılınca geri açılır.
//!
//! Denendi (bu makinede): bu öznitelik başka sürecin penceresinde S_OK döner
//! (`DWMWA_CLOAK` ise erişim reddi); küçültülmüş pencerenin küçük resmi tam
//! boyutlu (son görüntü). Belgeler (Microsoft Learn): hedef pencere bizim
//! sürecimize ait ve üst düzey olmalı; olay kancası WINEVENT_OUTOFCONTEXT ile
//! kurulduğu iş parçacığının mesaj döngüsünde çağrılır.
//!
//! Küçültme: nereden yapılırsa yapılsın (olay kancası). Geri yükleme: dock'tan
//! tıklanınca önce animasyon, sonra pencere açılır. Başka yerden (Alt+Tab) geri
//! yüklenen pencere animasyonsuz açılır (Windows'unki de kapalı).

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DWM_THUMBNAIL_PROPERTIES, DWM_TNP_OPACITY, DWM_TNP_RECTDESTINATION,
    DWM_TNP_SOURCECLIENTAREAONLY, DWM_TNP_VISIBLE, DWMWA_TRANSITIONS_FORCEDISABLED, DwmFlush,
    DwmRegisterThumbnail, DwmSetWindowAttribute, DwmUnregisterThumbnail,
    DwmUpdateThumbnailProperties,
};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, EVENT_SYSTEM_MINIMIZESTART, GetMessageW,
    GetWindowPlacement, GetWindowRect, HTTRANSPARENT, HWND_TOPMOST, IsIconic, IsWindow, MSG,
    PostMessageW, RegisterClassW, SPI_GETCLIENTAREAANIMATION, SW_HIDE, SW_RESTORE, SWP_NOACTIVATE,
    SWP_SHOWWINDOW, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS, SetWindowPos, ShowWindow,
    SystemParametersInfoW, TranslateMessage, WINDOWPLACEMENT, WINEVENT_OUTOFCONTEXT,
    WINEVENT_SKIPOWNPROCESS, WM_APP, WM_NCHITTEST, WNDCLASSW, WPF_RESTORETOMAXIMIZED,
    WS_EX_NOACTIVATE, WS_EX_NOREDIRECTIONBITMAP, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
    WS_EX_TRANSPARENT, WS_POPUP,
};
use windows::core::{BOOL, w};

use super::{focus, hwnd_to_id, id_to_hwnd, placement};
use crate::services::apps::AppsService;

const DURATION: Duration = Duration::from_millis(280);
/// Katman penceresine "şu pencereyi ikondan çıkararak aç" isteği (wParam = hwnd).
const WM_FX_RESTORE: u32 = WM_APP + 21;

static APP: OnceLock<AppHandle> = OnceLock::new();
static OVERLAY: AtomicIsize = AtomicIsize::new(0);
static ENABLED: AtomicBool = AtomicBool::new(false);
/// Windows geçişlerini kapattığımız pencereler (geri açmak için).
static TRACKED: Mutex<Option<HashSet<isize>>> = Mutex::new(None);
/// Uygulama kimliği → ikonun dinlenme konumu (dock penceresinde CSS piksel).
static ICONS: Mutex<Option<HashMap<String, IconRect>>> = Mutex::new(None);

/// Frontend'in bildirdiği ikon kutusu (büyütülmemiş düzen).
#[derive(Debug, Clone, Deserialize)]
pub struct IconRect {
    id: String,
    x: f64,
    y: f64,
    size: f64,
}

pub fn spawn(app: &AppHandle) {
    let _ = APP.set(app.clone());
    let spawned = std::thread::Builder::new()
        .name("window-fx".into())
        .spawn(|| unsafe {
            let Ok(instance) = GetModuleHandleW(None) else {
                return;
            };
            let class = WNDCLASSW {
                lpfnWndProc: Some(overlay_proc),
                hInstance: instance.into(),
                lpszClassName: w!("AkilliDockWindowFx"),
                ..Default::default()
            };
            RegisterClassW(&class);
            // Yüzeysiz (NOREDIRECTIONBITMAP) → tamamen saydam; yalnızca DWM küçük
            // resmi görünür. Tıklamayı ve odağı almaz.
            let Ok(overlay) = CreateWindowExW(
                WS_EX_NOREDIRECTIONBITMAP
                    | WS_EX_TOOLWINDOW
                    | WS_EX_NOACTIVATE
                    | WS_EX_TOPMOST
                    | WS_EX_TRANSPARENT,
                w!("AkilliDockWindowFx"),
                w!(""),
                WS_POPUP,
                0,
                0,
                0,
                0,
                None,
                None,
                Some(instance.into()),
                None,
            ) else {
                eprintln!("pencere animasyonu katmanı oluşturulamadı");
                return;
            };
            OVERLAY.store(hwnd_to_id(overlay), Ordering::SeqCst);
            // Kendi sürecimiz hariç; olaylar bu iş parçacığının mesaj döngüsüne gelir.
            SetWinEventHook(
                EVENT_SYSTEM_MINIMIZESTART,
                EVENT_SYSTEM_MINIMIZESTART,
                None,
                Some(on_minimize),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            );
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        });
    if let Err(e) = spawned {
        eprintln!("window-fx başlatılamadı: {e}");
    }
}

/// Ayar: açıkken yeni pencerelerde Windows geçişleri kapatılır; kapatınca hepsi geri açılır.
pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::SeqCst);
    if !on {
        let mut ids = TRACKED.lock().unwrap().take().unwrap_or_default();
        // Zorla kapatılan önceki bir çalışmanın kapattıkları da (takip listesinde
        // yok) geri açılsın: dock'taki tüm açık pencereler.
        if let Some(app) = APP.get()
            && let Some(apps) = app.try_state::<AppsService>()
        {
            ids.extend(
                apps.items()
                    .iter()
                    .flat_map(|i| i.windows.iter().map(|w| w.hwnd)),
            );
        }
        for id in ids {
            set_windows_transitions(id, true);
        }
    }
}

/// Çıkışta (ve çökmede) Windows'un geçişlerini geri ver.
pub fn shutdown() {
    set_enabled(false);
}

/// Uygulamalar yoklayıcısı her turda dock'taki pencereleri bildirir.
pub fn track(alive: &[isize]) {
    if !ENABLED.load(Ordering::SeqCst) {
        return;
    }
    let mut guard = TRACKED.lock().unwrap();
    let tracked = guard.get_or_insert_with(HashSet::new);
    let alive_set: HashSet<isize> = alive.iter().copied().collect();
    tracked.retain(|id| alive_set.contains(id));
    for &id in alive {
        if tracked.insert(id) {
            set_windows_transitions(id, false);
        }
    }
}

pub fn set_icon_rects(rects: Vec<IconRect>) {
    *ICONS.lock().unwrap() = Some(rects.into_iter().map(|r| (r.id.clone(), r)).collect());
}

/// Dock'tan geri yükleme: animasyonu katman iş parçacığı oynatır, sonra pencereyi
/// açıp öne getirir. `false`: animasyon yok, çağıran kendisi açsın.
pub fn restore_animated(id: isize) -> bool {
    let overlay = OVERLAY.load(Ordering::SeqCst);
    if !ENABLED.load(Ordering::SeqCst) || overlay == 0 || !animations_allowed() {
        return false;
    }
    unsafe {
        PostMessageW(
            Some(id_to_hwnd(overlay)),
            WM_FX_RESTORE,
            WPARAM(id as usize),
            LPARAM(0),
        )
        .is_ok()
    }
}

fn set_windows_transitions(id: isize, enabled: bool) {
    let disabled = BOOL::from(!enabled);
    unsafe {
        let _ = DwmSetWindowAttribute(
            id_to_hwnd(id),
            DWMWA_TRANSITIONS_FORCEDISABLED,
            &disabled as *const BOOL as *const _,
            size_of::<BOOL>() as u32,
        );
    }
}

/// Windows ayarı: Erişilebilirlik → Görsel efektler → Animasyon efektleri.
fn animations_allowed() -> bool {
    let mut on = BOOL::from(true);
    unsafe {
        let _ = SystemParametersInfoW(
            SPI_GETCLIENTAREAANIMATION,
            0,
            Some(&mut on as *mut BOOL as *mut _),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        );
    }
    on.as_bool()
}

// --- olaylar ------------------------------------------------------------------------

unsafe extern "system" fn overlay_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_FX_RESTORE => {
            restore(id_to_hwnd(wparam.0 as isize));
            LRESULT(0)
        }
        WM_NCHITTEST => LRESULT(HTTRANSPARENT as isize),
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

unsafe extern "system" fn on_minimize(
    _hook: HWINEVENTHOOK,
    _event: u32,
    hwnd: HWND,
    id_object: i32,
    id_child: i32,
    _thread: u32,
    _time: u32,
) {
    // Yalnızca pencerenin kendisi (OBJID_WINDOW = 0, CHILDID_SELF = 0).
    if id_object != 0 || id_child != 0 || !ENABLED.load(Ordering::SeqCst) {
        return;
    }
    if !animations_allowed() {
        return;
    }
    let Some(icon) = icon_rect_for(hwnd) else {
        return; // dock'ta olmayan pencere
    };
    let Some(from) = restored_rect(hwnd) else {
        return;
    };
    let to = fit_into(from, icon);
    if let Some(thumb) = animate(hwnd, from, to, Direction::IntoDock) {
        finish(thumb);
    }
}

/// Dock'tan istenen geri yükleme: ikondan pencereye, sonra gerçek pencere.
fn restore(hwnd: HWND) {
    let open = |hwnd: HWND| unsafe {
        let _ = ShowWindow(hwnd, SW_RESTORE);
    };
    if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
        return;
    }
    let path = icon_rect_for(hwnd).zip(restored_rect(hwnd));
    match path.and_then(|(icon, to)| animate(hwnd, fit_into(to, icon), to, Direction::OutOfDock)) {
        Some(thumb) => {
            // Önce gerçek pencere yerine otursun, sonra katmanı kaldır: boşluk kalmasın.
            open(hwnd);
            unsafe {
                let _ = DwmFlush();
                let _ = DwmFlush();
            }
            finish(thumb);
        }
        None => open(hwnd),
    }
    focus::activate(hwnd_to_id(hwnd));
}

// --- animasyon ------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
enum Direction {
    IntoDock,
    OutOfDock,
}

/// Küçük resmi `from`'dan `to`'ya taşır (ekran koordinatı). Bitince küçük resim
/// son karede kalır; `finish` ile kaldırılır.
fn animate(src: HWND, from: RECT, to: RECT, dir: Direction) -> Option<isize> {
    let overlay = id_to_hwnd(OVERLAY.load(Ordering::SeqCst));
    if overlay.is_invalid() {
        return None;
    }
    let monitor = placement::primary_monitor_rect();
    unsafe {
        SetWindowPos(
            overlay,
            Some(HWND_TOPMOST),
            monitor.left,
            monitor.top,
            monitor.right - monitor.left,
            monitor.bottom - monitor.top,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
        .ok()?;
        let thumb = DwmRegisterThumbnail(overlay, src).ok()?;
        let start = Instant::now();
        loop {
            let t = (start.elapsed().as_secs_f64() / DURATION.as_secs_f64()).min(1.0);
            // İçeri: hızlanarak girer, sonunda solar (kübik eğri ilk 130 ms'de
            // neredeyse kıpırdamadığı için gecikme gibi duruyordu → karesel).
            // Dışarı: yavaşlayarak açılır.
            let (k, alpha) = match dir {
                Direction::IntoDock => (t * t, 1.0 - 0.6 * t * t),
                Direction::OutOfDock => {
                    let e = 1.0 - (1.0 - t).powi(3);
                    (e, 0.3 + 0.7 * e)
                }
            };
            let r = lerp(from, to, k);
            let props = DWM_THUMBNAIL_PROPERTIES {
                dwFlags: DWM_TNP_RECTDESTINATION
                    | DWM_TNP_OPACITY
                    | DWM_TNP_VISIBLE
                    | DWM_TNP_SOURCECLIENTAREAONLY,
                rcDestination: RECT {
                    left: r.left - monitor.left,
                    top: r.top - monitor.top,
                    right: r.right - monitor.left,
                    bottom: r.bottom - monitor.top,
                },
                opacity: (alpha.clamp(0.0, 1.0) * 255.0) as u8,
                fVisible: true.into(),
                fSourceClientAreaOnly: false.into(),
                ..Default::default()
            };
            let _ = DwmUpdateThumbnailProperties(thumb, &props);
            if t >= 1.0 {
                break;
            }
            // Bir sonraki ekran yenilemesini bekle: 60 Hz'de akıcı, boşta CPU yok.
            if DwmFlush().is_err() {
                std::thread::sleep(Duration::from_millis(16));
            }
        }
        Some(thumb)
    }
}

fn finish(thumb: isize) {
    unsafe {
        let _ = DwmUnregisterThumbnail(thumb);
        let overlay = id_to_hwnd(OVERLAY.load(Ordering::SeqCst));
        let _ = ShowWindow(overlay, SW_HIDE);
    }
}

fn lerp(a: RECT, b: RECT, k: f64) -> RECT {
    let m = |x: i32, y: i32| (x as f64 + (y - x) as f64 * k).round() as i32;
    RECT {
        left: m(a.left, b.left),
        top: m(a.top, b.top),
        right: m(a.right, b.right),
        bottom: m(a.bottom, b.bottom),
    }
}

/// Pencereyi oranını koruyarak ikonun içine sığdırır (ikonun ortasında).
fn fit_into(window: RECT, icon: RECT) -> RECT {
    let (w, h) = (
        (window.right - window.left) as f64,
        (window.bottom - window.top) as f64,
    );
    let size = (icon.right - icon.left) as f64;
    let k = size / w.max(h).max(1.0);
    let (cx, cy) = (
        (icon.left + icon.right) as f64 / 2.0,
        (icon.top + icon.bottom) as f64 / 2.0,
    );
    RECT {
        left: (cx - w * k / 2.0).round() as i32,
        top: (cy - h * k / 2.0).round() as i32,
        right: (cx + w * k / 2.0).round() as i32,
        bottom: (cy + h * k / 2.0).round() as i32,
    }
}

// --- konumlar ------------------------------------------------------------------------

/// Pencerenin açıkken kapladığı yer (küçültülmüşse geri yükleneceği yer).
fn restored_rect(hwnd: HWND) -> Option<RECT> {
    unsafe {
        if !IsIconic(hwnd).as_bool() {
            let mut r = RECT::default();
            GetWindowRect(hwnd, &mut r).ok()?;
            return Some(r);
        }
        let mut wp = WINDOWPLACEMENT {
            length: size_of::<WINDOWPLACEMENT>() as u32,
            ..Default::default()
        };
        GetWindowPlacement(hwnd, &mut wp).ok()?;
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        GetMonitorInfoW(monitor, &mut info).ok().ok()?;
        if wp.flags.0 & WPF_RESTORETOMAXIMIZED.0 != 0 {
            return Some(info.rcWork);
        }
        // rcNormalPosition çalışma alanı koordinatında (çubuklar hesaba katılmış).
        let (dx, dy) = (
            info.rcWork.left - info.rcMonitor.left,
            info.rcWork.top - info.rcMonitor.top,
        );
        let r = wp.rcNormalPosition;
        Some(RECT {
            left: r.left + dx,
            top: r.top + dy,
            right: r.right + dx,
            bottom: r.bottom + dy,
        })
    }
}

/// Pencerenin ait olduğu uygulamanın dock ikonu (ekran koordinatı, fiziksel piksel).
fn icon_rect_for(hwnd: HWND) -> Option<RECT> {
    let app = APP.get()?;
    let id = hwnd_to_id(hwnd);
    let app_id = app
        .state::<AppsService>()
        .items()
        .into_iter()
        .find(|item| item.windows.iter().any(|w| w.hwnd == id))?
        .id;
    let rect = ICONS.lock().unwrap().as_ref()?.get(&app_id)?.clone();

    let dock = app.get_webview_window("dock")?.hwnd().ok()?;
    let mut origin = RECT::default();
    unsafe { GetWindowRect(dock, &mut origin) }.ok()?;
    let scale = placement::scale(dock);
    let px = |v: f64| (v * scale).round() as i32;
    Some(RECT {
        left: origin.left + px(rect.x),
        top: origin.top + px(rect.y),
        right: origin.left + px(rect.x + rect.size),
        bottom: origin.top + px(rect.y + rect.size),
    })
}
