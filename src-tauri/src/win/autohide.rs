//! 8.10 Otomatik gizlenme (PLAN-ASAMA-8.md).
//!
//! - `always`: dock gizli durur, imleç ekranın alt kenarına gelince çıkar.
//! - `smart`: yalnızca bir pencere dock'un alanıyla çakışıyorsa gizlenir.
//!
//! Mod açıkken AppBar kaydı kalır (tam ekran bildirimleri için) ama şerit
//! yalnızca 1 px ayırır (`appbar::set_pos`) → pencereler neredeyse tüm ekranı kullanır.
//!
//! Gizlenme: sayfa çubuğu kenara kaydırır (200 ms), sonra pencere bölgesi
//! kenardaki ince tetik şeridine iner (`placement::set_hidden`). İmleç şeride
//! girince (sayfa `pointer` ile bildirir) 100 ms sonra bölge açılır, çubuk
//! kayarak gelir. İmleç dock'tan çıkınca 600 ms sonra gizlenir; panel,
//! önizleme, sağ tık menüsü ya da büyütme / sürükleme varken gizlenmez.
//! Tam ekran mantığı (`appbar`) önceliklidir.
//!
//! Tek iş parçacığı + kanal, zamanlayıcılar `recv_timeout` ile. Akıllı modda
//! pencere olayları (`SetWinEventHook`, yalnız bu modda kurulur) dürter; olay
//! kaçarsa diye 2 sn'de bir yedek bakış.

use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{HWND, LPARAM, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute,
};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook, UnhookWinEvent};
use windows::Win32::UI::WindowsAndMessaging::{
    CHILDID_SELF, DispatchMessageW, EVENT_OBJECT_CLOAKED, EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE,
    EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_UNCLOAKED, EVENT_SYSTEM_FOREGROUND,
    EVENT_SYSTEM_MINIMIZEEND, EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MOVESIZEEND, EnumWindows,
    GA_ROOT, GWL_EXSTYLE, GetAncestor, GetClassNameW, GetMessageW, GetWindowLongW, GetWindowRect,
    IsIconic, IsWindowVisible, MSG, OBJID_WINDOW, PM_NOREMOVE, PeekMessageW, PostThreadMessageW,
    TranslateMessage, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WM_QUIT, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
};
use windows::core::BOOL;

use super::{appbar, hwnd_to_id, id_to_hwnd, is_own_window, placement, popup, preview};

pub const AUTOHIDE_CHANGED: &str = "autohide://changed";
/// İmleç tetik şeridine girdikten sonra (kenara yanlışlıkla değmeler açmasın).
const REVEAL_DELAY: Duration = Duration::from_millis(100);
/// İmleç dock'tan çıktıktan sonra.
const HIDE_DELAY: Duration = Duration::from_millis(600);
/// Sayfadaki kayma animasyonu (DockWindow.module.css, `--t-med`).
const SLIDE: Duration = Duration::from_millis(200);
/// Akıllı modda olay kaçarsa diye yedek bakış.
const SMART_RECHECK: Duration = Duration::from_secs(2);
const IDLE: Duration = Duration::from_secs(3600);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    Never = 0,
    Always = 1,
    Smart = 2,
}

impl Mode {
    /// Config değeri ("never" | "always" | "smart"); bilinmeyen → kapalı.
    pub fn parse(s: &str) -> Self {
        match s {
            "always" => Self::Always,
            "smart" => Self::Smart,
            _ => Self::Never,
        }
    }
}

static MODE: AtomicU8 = AtomicU8::new(0);
static MENU_OPEN: AtomicBool = AtomicBool::new(false);
static TX: OnceLock<Mutex<Sender<Msg>>> = OnceLock::new();
/// Akıllı mod pencere olayı iş parçacığı (0: yok).
static HOOK_THREAD: AtomicU32 = AtomicU32::new(0);

enum Msg {
    Pointer(bool),
    Poke,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Action {
    Hide,
    Shrink,
    Reveal,
}

pub fn mode() -> Mode {
    match MODE.load(Ordering::SeqCst) {
        1 => Mode::Always,
        2 => Mode::Smart,
        _ => Mode::Never,
    }
}

/// Mod açık: AppBar yalnızca 1 px ayırır.
pub fn active() -> bool {
    mode() != Mode::Never
}

fn send(msg: Msg) {
    if let Some(tx) = TX.get() {
        let _ = tx.lock().unwrap().send(msg);
    }
}

pub fn spawn(app: &AppHandle, hwnd: HWND, mode: Mode) {
    MODE.store(mode as u8, Ordering::SeqCst);
    let (tx, rx) = mpsc::channel();
    let _ = TX.set(Mutex::new(tx));
    let app = app.clone();
    let id = hwnd_to_id(hwnd);
    let spawned = std::thread::Builder::new()
        .name("autohide".into())
        .spawn(move || run(app, id, rx));
    if let Err(e) = spawned {
        eprintln!("autohide başlatılamadı: {e}");
    }
    sync_hooks();
    send(Msg::Poke);
}

/// Ayar değişti. Çağıran ardından yerleşimi yeniler (şerit ayırma değişir).
pub fn set_mode(mode: Mode) {
    MODE.store(mode as u8, Ordering::SeqCst);
    sync_hooks();
    send(Msg::Poke);
}

/// Sayfa: imleç dock penceresinin (görünür bölgesinin) içinde mi.
pub fn pointer(inside: bool) {
    send(Msg::Pointer(inside));
}

/// Gizlenmeyi engelleyen bir durum bitti (panel / menü / önizleme kapandı,
/// büyütme bitti, tam ekrandan çıkıldı) ya da pencereler değişti.
pub fn poke() {
    if active() {
        send(Msg::Poke);
    }
}

/// Dock'un sağ tık menüsü açık (menü çağrısı kapanana dek bekler).
pub fn set_menu_open(open: bool) {
    MENU_OPEN.store(open, Ordering::SeqCst);
    poke();
}

fn run(app: AppHandle, id: isize, rx: mpsc::Receiver<Msg>) {
    let hwnd = || id_to_hwnd(id);
    let mut hidden = false;
    let mut inside = false;
    let mut timer: Option<(Instant, Action)> = None;
    loop {
        let wait = match timer {
            Some((at, _)) => at.saturating_duration_since(Instant::now()),
            None if mode() == Mode::Smart => SMART_RECHECK,
            None => IDLE,
        };
        match rx.recv_timeout(wait) {
            Ok(msg) => {
                // Art arda gelenleri (akıllı modda pencere sürüklenirken) birleştir.
                let mut apply = |m: Msg| {
                    if let Msg::Pointer(v) = m {
                        inside = v;
                    }
                };
                apply(msg);
                while let Ok(m) = rx.try_recv() {
                    apply(m);
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }

        // Tam ekran öncelikli: dock zaten gizli, dokunma.
        if appbar::fullscreen_hidden() {
            timer = None;
            continue;
        }

        // Vakti gelen zamanlayıcı.
        if let Some((at, action)) = timer
            && Instant::now() >= at
        {
            timer = None;
            match action {
                Action::Hide => {
                    if !hidden && !inside && want_hidden() {
                        hidden = true;
                        let _ = app.emit(AUTOHIDE_CHANGED, true);
                        timer = Some((Instant::now() + SLIDE, Action::Shrink));
                        continue;
                    }
                }
                Action::Shrink => {
                    if hidden {
                        placement::set_hidden(hwnd(), true);
                    }
                }
                Action::Reveal => {
                    if hidden && inside {
                        hidden = false;
                        reveal(&app, hwnd());
                    }
                }
            }
        }

        let pending = timer.map(|t| t.1);
        if hidden {
            if inside {
                if pending != Some(Action::Reveal) {
                    timer = Some((Instant::now() + REVEAL_DELAY, Action::Reveal));
                }
            } else if !want_hidden() {
                // Mod kapandı, çakışma bitti ya da bir panel açıldı: hemen göster.
                hidden = false;
                timer = None;
                reveal(&app, hwnd());
            } else if pending == Some(Action::Reveal) {
                // İmleç şeride değip hemen çıktı.
                timer = None;
            }
        } else if !inside && want_hidden() {
            if pending.is_none() {
                timer = Some((Instant::now() + HIDE_DELAY, Action::Hide));
            }
        } else if pending == Some(Action::Hide) {
            timer = None;
        }
    }
}

fn reveal(app: &AppHandle, hwnd: HWND) {
    placement::set_hidden(hwnd, false);
    let _ = app.emit(AUTOHIDE_CHANGED, false);
}

/// İmleç dışarıdayken gizli olmalı mı.
fn want_hidden() -> bool {
    let busy = popup::is_open()
        || preview::is_visible()
        || MENU_OPEN.load(Ordering::SeqCst)
        || placement::is_expanded();
    match mode() {
        Mode::Never => false,
        Mode::Always => !busy,
        Mode::Smart => !busy && overlapped(),
    }
}

// --- akıllı mod: çakışma ------------------------------------------------------------

/// Görünür bir uygulama penceresi dock çubuğunun şeridine giriyor mu.
fn overlapped() -> bool {
    let Some(bar) = placement::reserved_rect() else {
        return false;
    };
    let mut ctx = Overlap { bar, hit: false };
    unsafe {
        let _ = EnumWindows(Some(enum_window), LPARAM(&mut ctx as *mut Overlap as isize));
    }
    ctx.hit
}

struct Overlap {
    bar: RECT,
    hit: bool,
}

unsafe extern "system" fn enum_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let ctx = unsafe { &mut *(lparam.0 as *mut Overlap) };
    if counts(hwnd)
        && let Some(r) = frame(hwnd)
        && r.left < ctx.bar.right
        && r.right > ctx.bar.left
        && r.top < ctx.bar.bottom
        && r.bottom > ctx.bar.top
    {
        ctx.hit = true;
        return BOOL(0);
    }
    BOOL(1)
}

/// Sayılan pencere: görünür, simge durumunda değil, başka masaüstünde değil,
/// araç / tıklama geçiren katman değil, kabuğun ya da bizim değil.
fn counts(hwnd: HWND) -> bool {
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() || is_own_window(hwnd) {
            return false;
        }
        let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        if ex & (WS_EX_TOOLWINDOW.0 | WS_EX_TRANSPARENT.0 | WS_EX_NOACTIVATE.0) != 0 {
            return false;
        }
        let mut cloaked = 0u32;
        if DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut _,
            size_of::<u32>() as u32,
        )
        .is_ok()
            && cloaked != 0
        {
            return false;
        }
        let mut buf = [0u16; 32];
        let n = GetClassNameW(hwnd, &mut buf);
        let class = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        !matches!(
            class.as_str(),
            "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
        )
    }
}

/// Görünen çerçeve (görünmez boyutlandırma kenarları hariç).
fn frame(hwnd: HWND) -> Option<RECT> {
    let mut r = RECT::default();
    unsafe {
        let ok = DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut r as *mut RECT as *mut _,
            size_of::<RECT>() as u32,
        )
        .is_ok()
            || GetWindowRect(hwnd, &mut r).is_ok();
        (ok && r.right > r.left && r.bottom > r.top).then_some(r)
    }
}

// --- akıllı mod: pencere olayları -------------------------------------------------------

/// Pencere olayı kancası yalnızca akıllı modda: konum olayları (imleç dahil
/// her taşınmada gelir) başka modlarda boşa iş olurdu.
///
/// Mod hızla değişirse: iş parçacığı kimliğini yazmadan önce mod kapanmış
/// olabilir (o zaman kendisi çıkar), iki iş parçacığı birden başlamış olabilir
/// (yalnızca kimliği ilk yazan kalır).
fn sync_hooks() {
    if mode() == Mode::Smart {
        if HOOK_THREAD.load(Ordering::SeqCst) == 0 {
            let _ = std::thread::Builder::new()
                .name("autohide-hooks".into())
                .spawn(hook_thread);
        }
    } else {
        let running = HOOK_THREAD.swap(0, Ordering::SeqCst);
        if running != 0 {
            unsafe {
                let _ = PostThreadMessageW(running, WM_QUIT, WPARAM(0), LPARAM(0));
            }
        }
    }
}

fn hook_thread() {
    unsafe {
        // Önce mesaj kuyruğu: kimlik görünür olur olmaz gelen WM_QUIT kaybolmasın.
        let mut msg = MSG::default();
        let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
        let me = GetCurrentThreadId();
        if HOOK_THREAD
            .compare_exchange(0, me, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
        if mode() != Mode::Smart {
            // Biz başlarken mod kapandı.
            let _ = HOOK_THREAD.compare_exchange(me, 0, Ordering::SeqCst, Ordering::SeqCst);
            return;
        }
        let mut hooks: Vec<HWINEVENTHOOK> = Vec::new();
        for (min, max) in [
            (EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND),
            (EVENT_SYSTEM_MOVESIZEEND, EVENT_SYSTEM_MOVESIZEEND),
            (EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND),
            // DESTROY, SHOW, HIDE ardışık.
            (EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE),
            (EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE),
            (EVENT_OBJECT_CLOAKED, EVENT_OBJECT_UNCLOAKED),
        ] {
            let h = SetWinEventHook(
                min,
                max,
                None,
                Some(on_window_event),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            );
            if !h.is_invalid() {
                hooks.push(h);
            }
        }
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        for h in hooks {
            let _ = UnhookWinEvent(h);
        }
    }
}

unsafe extern "system" fn on_window_event(
    _hook: HWINEVENTHOOK,
    _event: u32,
    hwnd: HWND,
    id_object: i32,
    id_child: i32,
    _thread: u32,
    _time: u32,
) {
    // Yalnızca üst düzey pencerelerin kendisi (imleç / imleç çizgisi konumları değil).
    if id_object != OBJID_WINDOW.0 || id_child != CHILDID_SELF as i32 || hwnd.is_invalid() {
        return;
    }
    if unsafe { GetAncestor(hwnd, GA_ROOT) } == hwnd {
        poke();
    }
}

#[cfg(test)]
mod tests {
    use super::Mode;

    #[test]
    fn parses_mode() {
        assert_eq!(Mode::parse("always"), Mode::Always);
        assert_eq!(Mode::parse("smart"), Mode::Smart);
        assert_eq!(Mode::parse("never"), Mode::Never);
        assert_eq!(Mode::parse("bozuk"), Mode::Never);
    }
}
