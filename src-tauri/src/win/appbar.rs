//! AppBar: ekranda dock için yer ayırma (bölüm 4.1).
//!
//! Protokol (learn.microsoft.com "Using Application Desktop Toolbars"):
//! `ABM_NEW` → `ABM_QUERYPOS` → (kalınlığı yeniden ayarla) → `ABM_SETPOS`.
//! `WM_ACTIVATE` → `ABM_ACTIVATE`, `WM_WINDOWPOSCHANGED` → `ABM_WINDOWPOSCHANGED`.
//! Çıkmadan önce mutlaka `ABM_REMOVE`.
//!
//! Tam ekran uygulama açılınca (`ABN_FULLSCREENAPP`) dock gizlenir, kapanınca
//! (ya da Alt+Tab ile çıkılınca) geri gelir; bkz. `set_fullscreen_z`.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};

use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow,
};
use windows::Win32::UI::Shell::{
    ABE_BOTTOM, ABE_TOP, ABM_ACTIVATE, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS,
    ABM_WINDOWPOSCHANGED, ABN_FULLSCREENAPP, ABN_POSCHANGED, APPBARDATA, DefSubclassProc,
    QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN, SHAppBarMessage,
    SHQueryUserNotificationState, SetWindowSubclass,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GWL_EXSTYLE, GetClassNameW, GetForegroundWindow, GetWindowLongW, GetWindowRect,
    GetWindowThreadProcessId, HWND_TOPMOST, PostMessageW, RegisterWindowMessageW, SW_HIDE,
    SW_SHOWNOACTIVATE, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SetWindowPos, ShowWindow,
    WM_ACTIVATE, WM_APP, WM_DISPLAYCHANGE, WM_DPICHANGED, WM_WINDOWPOSCHANGED, WS_EX_TOPMOST,
};
use windows::core::w;

use super::placement::{self, EDGE, Edge};
use super::{hwnd_to_id, id_to_hwnd, taskbar};
use crate::error::{AppError, AppResult};

/// Kabuğun bize bildirim gönderdiği mesaj.
const CALLBACK_MSG: u32 = WM_APP + 1;
/// Yeniden yerleşimi mesaj kuyruğuna erteler (iç içe çağrıları önler).
const DEFERRED_REPOSITION: u32 = WM_APP + 2;
const SUBCLASS_ID: usize = 0xAB01;

pub const FULLSCREEN_CHANGED: &str = "fullscreen://changed";

static REGISTERED: AtomicBool = AtomicBool::new(false);
static DOCK_HWND: AtomicIsize = AtomicIsize::new(0);
static APP: OnceLock<AppHandle> = OnceLock::new();
/// Explorer yeniden başlayınca yayınlanan mesaj.
static TASKBAR_CREATED: OnceLock<u32> = OnceLock::new();

pub fn register(app: &AppHandle, hwnd: HWND) -> AppResult<()> {
    let _ = APP.set(app.clone());
    let _ = TASKBAR_CREATED.get_or_init(|| unsafe { RegisterWindowMessageW(w!("TaskbarCreated")) });
    DOCK_HWND.store(hwnd_to_id(hwnd), Ordering::SeqCst);
    unsafe {
        if !SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0).as_bool() {
            return Err(AppError::Win32("AppBar alt sınıflama başarısız".into()));
        }
    }
    new_appbar(hwnd)?;
    check_fullscreen_at_start(hwnd);
    Ok(())
}

/// Dock, tam ekran oyun açıkken başlarsa kabuk `ABN_FULLSCREENAPP` göndermiyor
/// (bu makinede görüldü): dock oyunun üstünde kalıyordu. Açılışta kabuğa sorulur.
fn check_fullscreen_at_start(hwnd: HWND) {
    let id = hwnd_to_id(hwnd);
    std::thread::spawn(move || {
        // Dock önce yerleşip görünsün; sonra gerekiyorsa normal yoldan çekilir.
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let state = unsafe { SHQueryUserNotificationState() };
        let busy = matches!(
            state,
            Ok(QUNS_BUSY | QUNS_RUNNING_D3D_FULL_SCREEN | QUNS_PRESENTATION_MODE)
        );
        if busy && foreground_is_fullscreen() {
            if cfg!(debug_assertions) {
                eprintln!(
                    "[appbar] açılışta tam ekran uygulama var ({}): dock çekiliyor",
                    describe_foreground()
                );
            }
            SHELL_FULLSCREEN.store(true, Ordering::SeqCst);
            enter_fullscreen(id_to_hwnd(id));
        }
    });
}

fn data(hwnd: HWND) -> APPBARDATA {
    APPBARDATA {
        cbSize: size_of::<APPBARDATA>() as u32,
        hWnd: hwnd,
        ..Default::default()
    }
}

fn new_appbar(hwnd: HWND) -> AppResult<()> {
    let mut abd = data(hwnd);
    abd.uCallbackMessage = CALLBACK_MSG;
    if unsafe { SHAppBarMessage(ABM_NEW, &mut abd) } == 0 {
        return Err(AppError::Win32("ABM_NEW reddedildi".into()));
    }
    REGISTERED.store(true, Ordering::SeqCst);
    Ok(())
}

/// Kenarda `thickness` kalınlığında şerit ister; sistemin onayladığı dikdörtgeni döner.
pub fn set_pos(hwnd: HWND, monitor: RECT, thickness: i32) -> Option<RECT> {
    if !REGISTERED.load(Ordering::SeqCst) {
        return None;
    }
    let mut abd = data(hwnd);
    abd.rc = monitor;
    match EDGE {
        Edge::Bottom => {
            abd.uEdge = ABE_BOTTOM;
            abd.rc.top = abd.rc.bottom - thickness;
        }
        Edge::Top => {
            abd.uEdge = ABE_TOP;
            abd.rc.bottom = abd.rc.top + thickness;
        }
    }
    unsafe { SHAppBarMessage(ABM_QUERYPOS, &mut abd) };
    // Sistem yalnızca çıkarma yapar, boyutu korumaz: kalınlığı yeniden ayarla.
    match EDGE {
        Edge::Bottom => abd.rc.top = abd.rc.bottom - thickness,
        Edge::Top => abd.rc.bottom = abd.rc.top + thickness,
    }
    unsafe { SHAppBarMessage(ABM_SETPOS, &mut abd) };
    Some(abd.rc)
}

/// Ayrılan yeri geri verir. Çıkışta ve panik kancasında çağrılır; iki kez çağrılması zararsız.
pub fn remove() {
    if REGISTERED.swap(false, Ordering::SeqCst) {
        let hwnd = id_to_hwnd(DOCK_HWND.load(Ordering::SeqCst));
        let mut abd = data(hwnd);
        unsafe { SHAppBarMessage(ABM_REMOVE, &mut abd) };
    }
}

/// Yerleşimi pencerenin kendi iş parçacığında yeniden yap (ör. boyut ayarı değişti).
pub fn post_reposition(hwnd: HWND) {
    unsafe {
        let _ = PostMessageW(Some(hwnd), DEFERRED_REPOSITION, WPARAM(0), LPARAM(0));
    }
}

/// Explorer, Windows çubuğu gizliyken büyütülmüş sıradan pencereleri de tam ekran
/// sanıp bildirim gönderiyor; dock da arkaya düşüp kayboluyordu. Ön plandaki
/// pencere gerçekten tüm monitörü kaplamıyorsa bildirimi yok say.
fn foreground_is_fullscreen() -> bool {
    unsafe {
        let fg = GetForegroundWindow();
        if fg.is_invalid() {
            return false;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(fg, Some(&mut pid));
        if pid == std::process::id() {
            return false;
        }
        let mut buf = [0u16; 64];
        let n = GetClassNameW(fg, &mut buf);
        let class = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        if matches!(
            class.as_str(),
            "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
        ) {
            return false;
        }
        let mut rect = RECT::default();
        if GetWindowRect(fg, &mut rect).is_err() {
            return false;
        }
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let _ = GetMonitorInfoW(MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST), &mut info);
        let m = info.rcMonitor;
        rect.left <= m.left && rect.top <= m.top && rect.right >= m.right && rect.bottom >= m.bottom
    }
}

/// Tam ekrana girerken çubuğun aşağı kayma animasyonu (DockWindow.module.css).
const FULLSCREEN_SLIDE: std::time::Duration = std::time::Duration::from_millis(200);
/// Her tam ekran bildiriminde artar: gecikmeli "arkaya al" eskidiyse uygulanmaz.
static FULLSCREEN_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Bildirim geldiğinde tam ekran pencere henüz boyutlanmamış olabilir (tarayıcıda
/// video tam ekrana geçerken): bu aralıklarla yeniden bakılır.
const FULLSCREEN_RECHECK_MS: [u64; 4] = [100, 150, 250, 500];

/// Kabuğun son `ABN_FULLSCREENAPP` bildirimi: monitörde tam ekran uygulama var.
static SHELL_FULLSCREEN: AtomicBool = AtomicBool::new(false);
/// Dock şu an tam ekran yüzünden arkada / gizli.
static HIDDEN: AtomicBool = AtomicBool::new(false);

fn on_fullscreen(hwnd: HWND, opening: bool) {
    SHELL_FULLSCREEN.store(opening, Ordering::SeqCst);
    if opening {
        enter_when_ready(hwnd);
    } else {
        exit_fullscreen(hwnd);
    }
}

/// Ön plan değişti (app_events). Kabuk, oyundan Alt+Tab ile çıkınca "tam ekran
/// bitti" bildirimini göndermiyor (oyun arkada hâlâ monitörü kaplıyor): dock
/// arkada kalıp tamamen kayboluyordu. Kabuk tam ekran derken ön plana bakılır:
/// ön plan monitörü kaplamıyorsa dock geri gelir, oyuna dönülünce yine çekilir.
pub fn on_foreground_changed() {
    if !REGISTERED.load(Ordering::SeqCst) || !SHELL_FULLSCREEN.load(Ordering::SeqCst) {
        return;
    }
    let hwnd = id_to_hwnd(DOCK_HWND.load(Ordering::SeqCst));
    if HIDDEN.load(Ordering::SeqCst) {
        if !foreground_is_fullscreen() {
            if cfg!(debug_assertions) {
                eprintln!(
                    "[appbar] tam ekran pencere ön planda değil ({}): dock geri geliyor",
                    describe_foreground()
                );
            }
            exit_fullscreen(hwnd);
        }
    } else {
        enter_when_ready(hwnd);
    }
}

/// Ön plan monitörü kaplıyorsa çekil. Kaplamıyorsa henüz boyutlanmamış olabilir
/// (tarayıcı videosu, küçültülmüş oyunun geri gelmesi): kısa aralıklarla yeniden bak.
fn enter_when_ready(hwnd: HWND) {
    if foreground_is_fullscreen() {
        enter_fullscreen(hwnd);
        return;
    }
    if cfg!(debug_assertions) {
        eprintln!(
            "[appbar] tam ekran: ön plan henüz monitörü kaplamıyor ({}), yeniden bakılacak",
            describe_foreground()
        );
    }
    // Kapanma bildirimi (ya da yenisi) gelirse sayaç değişir, bekleme biter.
    let generation = FULLSCREEN_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let id = hwnd_to_id(hwnd);
    std::thread::spawn(move || {
        for ms in FULLSCREEN_RECHECK_MS {
            std::thread::sleep(std::time::Duration::from_millis(ms));
            if FULLSCREEN_GEN.load(Ordering::SeqCst) != generation {
                return;
            }
            if foreground_is_fullscreen() {
                enter_fullscreen(id_to_hwnd(id));
                return;
            }
        }
    });
}

fn exit_fullscreen(hwnd: HWND) {
    FULLSCREEN_GEN.fetch_add(1, Ordering::SeqCst);
    HIDDEN.store(false, Ordering::SeqCst);
    if let Some(app) = APP.get() {
        let _ = app.emit(FULLSCREEN_CHANGED, false);
    }
    set_fullscreen_z(hwnd, false);
}

/// Günlük için: ön plandaki pencerenin sınıfı, dikdörtgeni ve monitörü.
fn describe_foreground() -> String {
    unsafe {
        let fg = GetForegroundWindow();
        let mut buf = [0u16; 64];
        let n = GetClassNameW(fg, &mut buf);
        let class = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        let mut r = RECT::default();
        let _ = GetWindowRect(fg, &mut r);
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let _ = GetMonitorInfoW(MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST), &mut info);
        let m = info.rcMonitor;
        format!(
            "{class} {},{} {}x{} / monitör {}x{}",
            r.left,
            r.top,
            r.right - r.left,
            r.bottom - r.top,
            m.right - m.left,
            m.bottom - m.top
        )
    }
}

fn enter_fullscreen(hwnd: HWND) {
    let generation = FULLSCREEN_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    HIDDEN.store(true, Ordering::SeqCst);
    // Önce sayfaya haber ver: girişte çubuk aşağı kayar, dock ancak sonra arkaya
    // alınır (yoksa animasyon tam ekran pencerenin arkasında kalır). Çıkışta dock
    // hemen öne gelir, çubuk yukarı kayarak belirir.
    if let Some(app) = APP.get() {
        let _ = app.emit(FULLSCREEN_CHANGED, true);
    }
    let id = hwnd_to_id(hwnd);
    std::thread::spawn(move || {
        std::thread::sleep(FULLSCREEN_SLIDE);
        if FULLSCREEN_GEN.load(Ordering::SeqCst) == generation {
            set_fullscreen_z(id_to_hwnd(id), true);
        }
    });
}

/// Tam ekranda dock gizlenir, çıkınca yeniden gösterilir.
///
/// Doküman appbar'ın z-sırasının en altına inmesini söylüyor; ilk sürüm böyle
/// yapıyordu (NOTOPMOST + BOTTOM, çıkışta TOPMOST). Ama tam ekran oyun ön
/// plandayken Windows "en üstte" bayrağını geri koymayı sessizce yok sayıyor
/// (SetWindowPos başarılı dönüyor, bayrak gelmiyor; bu makinede STRAFTAT ile
/// görüldü): Alt+Tab'da dock oyunun arkasında kalıp tamamen kayboluyordu.
/// Bayrağa hiç dokunmadan gizleyip göstermek bu sorunu taşımıyor; AppBar
/// kaydı ve ayrılan şerit pencere gizliyken de yerinde kalır.
fn set_fullscreen_z(hwnd: HWND, opening: bool) {
    unsafe {
        if opening {
            let _ = ShowWindow(hwnd, SW_HIDE);
        } else {
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            // Bayrak bir yerde düştüyse (eski sürüm, başka araç) yine de dene.
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
        if cfg!(debug_assertions) {
            let topmost = GetWindowLongW(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST.0 as i32 != 0;
            eprintln!(
                "[appbar] dock {} (en üstte: {topmost})",
                if opening { "gizlendi" } else { "gösterildi" }
            );
        }
    }
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    let registered = REGISTERED.load(Ordering::SeqCst);
    match msg {
        CALLBACK_MSG => {
            if cfg!(debug_assertions) {
                eprintln!("[appbar] bildirim {} lparam={}", wparam.0, lparam.0);
            }
            match wparam.0 as u32 {
                ABN_POSCHANGED => post_reposition(hwnd),
                ABN_FULLSCREENAPP => on_fullscreen(hwnd, lparam.0 != 0),
                _ => {}
            }
        }
        DEFERRED_REPOSITION => {
            if let Err(e) = placement::reposition(hwnd) {
                eprintln!("yeniden yerleşim başarısız: {e}");
            }
        }
        WM_ACTIVATE if registered => {
            let mut abd = data(hwnd);
            unsafe { SHAppBarMessage(ABM_ACTIVATE, &mut abd) };
        }
        WM_WINDOWPOSCHANGED if registered => {
            let mut abd = data(hwnd);
            unsafe { SHAppBarMessage(ABM_WINDOWPOSCHANGED, &mut abd) };
        }
        WM_DISPLAYCHANGE | WM_DPICHANGED => post_reposition(hwnd),
        m if Some(&m) == TASKBAR_CREATED.get() => {
            // Explorer yeniden başladı: kayıt kayboldu, baştan kaydol.
            REGISTERED.store(false, Ordering::SeqCst);
            if let Err(e) = new_appbar(hwnd) {
                eprintln!("AppBar yeniden kaydı başarısız: {e}");
            }
            post_reposition(hwnd);
            taskbar::on_explorer_restart();
        }
        _ => {}
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}
