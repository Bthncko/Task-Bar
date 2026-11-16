//! Windows görev çubuğunu gizleme / geri getirme (bölüm 4.2).
//!
//! Resmi "kaldır" yolu yok. Yöntem:
//! 1. `ABM_SETSTATE(ABS_AUTOHIDE)` → çubuk ekranda yer ayırmayı bırakır.
//! 2. `Shell_TrayWnd` + `Shell_SecondaryTrayWnd` → `SW_HIDE`.
//! 3. Explorer çubuğu geri gösterir (ör. otomatik gizlemeye geçerken, Win tuşunda,
//!    fare alt kenara gelince): çubuğa boş pencere bölgesi verilir (görünse de
//!    çizilmez), bekçi iş parçacığı da kısa aralıklarla bakıp yeniden gizler.
//! 4. Çıkışta: göster + eski otomatik gizleme durumunu geri yükle.
//!
//! Güvenlik ağı: eski durum diske yazılır (`taskbar-state.json`). Uygulama çökerse
//! bir sonraki açılışta ya da `scripts/restore-taskbar.ps1` ile geri getirilir.

use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{CreateRectRgn, GetWindowRgnBox, NULLREGION, SetWindowRgn};
use windows::Win32::UI::Shell::{
    ABM_GETSTATE, ABM_SETSTATE, ABS_ALWAYSONTOP, ABS_AUTOHIDE, APPBARDATA, SHAppBarMessage,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowW, GetClassNameW, IsWindowVisible, SW_HIDE, SW_SHOW, ShowWindow,
    ShowWindowAsync,
};
use windows::core::{BOOL, w};

use crate::error::AppResult;

const STATE_FILE: &str = "taskbar-state.json";
const WATCH_INTERVAL: Duration = Duration::from_millis(300);

#[derive(Serialize, Deserialize)]
struct SavedState {
    autohide: bool,
}

struct Control {
    state_path: PathBuf,
    want_hidden: AtomicBool,
    /// Kullanıcının asıl otomatik gizleme ayarı. Oturum başında bir kez okunur:
    /// sonradan okumak, bizim yaptığımız (henüz işlenmemiş) değişikliği okuyabilir.
    original_autohide: bool,
}

static CONTROL: OnceLock<Control> = OnceLock::new();

/// Açılışta: istenen duruma getir, önceki çökmeden kalanı onar, bekçiyi başlat.
pub fn init(config_dir: PathBuf, want_hidden: bool) {
    let state_path = config_dir.join(STATE_FILE);
    // Önceki oturum çöktüyse asıl ayar dosyada; değilse şu anki ayar asıl ayardır.
    let original_autohide = read_saved(&state_path).unwrap_or_else(current_autohide);
    let control = CONTROL.get_or_init(|| Control {
        state_path,
        want_hidden: AtomicBool::new(false),
        original_autohide,
    });
    if want_hidden {
        hide(control);
    } else if control.state_path.exists() {
        // Önceki oturum çökmüş ve çubuk gizli kalmış.
        restore(control);
    }
    std::thread::Builder::new()
        .name("taskbar-watch".into())
        .spawn(watch)
        .expect("taskbar-watch başlatılamadı");
}

pub fn set_hidden(hidden: bool) {
    let Some(control) = CONTROL.get() else { return };
    if hidden {
        hide(control);
    } else {
        restore(control);
    }
}

/// Çıkışta / panikte: çubuğu geri getir. Kullanıcı ayarına (config) dokunmaz.
pub fn cleanup() {
    if let Some(control) = CONTROL.get()
        && control.want_hidden.load(Ordering::SeqCst)
    {
        restore(control);
    }
}

/// Explorer yeniden başladı: gizliysek otomatik gizlemeyi yeniden kur.
pub fn on_explorer_restart() {
    if let Some(control) = CONTROL.get()
        && control.want_hidden.load(Ordering::SeqCst)
    {
        set_autohide(true);
    }
}

fn hide(control: &Control) {
    // Güvenlik ağı: asıl ayarı diske yaz (çökersek betik / sonraki açılış okur).
    if let Err(e) = save_state(control) {
        eprintln!("görev çubuğu durumu kaydedilemedi: {e}");
    }
    control.want_hidden.store(true, Ordering::SeqCst);
    set_autohide(true);
    hide_bars();
}

fn restore(control: &Control) {
    control.want_hidden.store(false, Ordering::SeqCst);
    // Önce çubuk gerçekten görünür olsun (eşzamanlı), sonra ayarı geri ver:
    // gizliyken gönderilen ABM_SETSTATE'i Explorer yok sayabiliyor.
    for bar in taskbar_windows() {
        unsafe {
            SetWindowRgn(bar, None, true);
            let _ = ShowWindow(bar, SW_SHOW);
        }
    }
    set_autohide(control.original_autohide);
    let _ = fs::remove_file(&control.state_path);
}

fn read_saved(path: &std::path::Path) -> Option<bool> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str::<SavedState>(&text)
        .ok()
        .map(|s| s.autohide)
}

fn save_state(control: &Control) -> AppResult<()> {
    if let Some(dir) = control.state_path.parent() {
        fs::create_dir_all(dir)?;
    }
    let state = SavedState {
        autohide: control.original_autohide,
    };
    fs::write(&control.state_path, serde_json::to_vec(&state)?)?;
    Ok(())
}

fn watch() {
    loop {
        std::thread::sleep(WATCH_INTERVAL);
        let Some(control) = CONTROL.get() else {
            continue;
        };
        if control.want_hidden.load(Ordering::SeqCst) {
            hide_bars();
        }
    }
}

/// Çubuğu gizler ve boş pencere bölgesi verir. Otomatik gizlemedeki çubuk, fare
/// ekranın alt kenarına gelince Explorer tarafından gösteriliyor; boş bölge
/// sayesinde gösterilse bile hiçbir şey çizilmez ve tıklamalar dock'a geçer.
/// Eşzamansız: Explorer meşgulse dock beklemesin.
fn hide_bars() {
    for bar in taskbar_windows() {
        unsafe {
            let mut box_ = RECT::default();
            if GetWindowRgnBox(bar, &mut box_) != NULLREGION {
                SetWindowRgn(bar, Some(CreateRectRgn(0, 0, 0, 0)), true);
            }
            if IsWindowVisible(bar).as_bool() {
                let _ = ShowWindowAsync(bar, SW_HIDE);
            }
        }
    }
}

fn tray_window() -> Option<HWND> {
    unsafe { FindWindowW(w!("Shell_TrayWnd"), None).ok() }
}

fn current_autohide() -> bool {
    let mut abd = APPBARDATA {
        cbSize: size_of::<APPBARDATA>() as u32,
        ..Default::default()
    };
    let state = unsafe { SHAppBarMessage(ABM_GETSTATE, &mut abd) } as u32;
    state & ABS_AUTOHIDE != 0
}

fn set_autohide(on: bool) {
    let Some(tray) = tray_window() else { return };
    let mut abd = APPBARDATA {
        cbSize: size_of::<APPBARDATA>() as u32,
        hWnd: tray,
        lParam: LPARAM(if on { ABS_AUTOHIDE } else { ABS_ALWAYSONTOP } as isize),
        ..Default::default()
    };
    unsafe { SHAppBarMessage(ABM_SETSTATE, &mut abd) };
}

/// Ana ve ikincil monitör görev çubukları.
fn taskbar_windows() -> Vec<HWND> {
    let mut found: Vec<HWND> = Vec::new();
    unsafe {
        let _ = EnumWindows(
            Some(collect_bars),
            LPARAM(&mut found as *mut Vec<HWND> as isize),
        );
    }
    found
}

unsafe extern "system" fn collect_bars(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let mut buf = [0u16; 64];
    let n = unsafe { GetClassNameW(hwnd, &mut buf) };
    let class = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
    if class == "Shell_TrayWnd" || class == "Shell_SecondaryTrayWnd" {
        // SAFETY: lparam, `taskbar_windows` içindeki yerel Vec; EnumWindows senkron.
        let found = unsafe { &mut *(lparam.0 as *mut Vec<HWND>) };
        found.push(hwnd);
    }
    true.into()
}
