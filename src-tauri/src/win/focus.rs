//! Başka uygulamaların pencerelerini öne getirme / küçültme / kapatma (bölüm 5.4).

use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_MOUSE, MOUSEINPUT, SendInput,
};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, IsIconic, PostMessageW,
    SC_MINIMIZE, SW_RESTORE, SetForegroundWindow, ShowWindowAsync, WM_CLOSE, WM_SYSCOMMAND,
};

use super::{hwnd_to_id, id_to_hwnd};

pub fn foreground() -> isize {
    hwnd_to_id(unsafe { GetForegroundWindow() })
}

pub fn window_pid(id: isize) -> u32 {
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(id_to_hwnd(id), Some(&mut pid)) };
    pid
}

/// Pencereyi öne getirir; simge durumundaysa önce geri yükler.
///
/// Dock'a yapılan tıklamayı bizim süreç değil WebView2 süreci alır; bu yüzden
/// Windows'un ön plan kısıtı `SetForegroundWindow`'u genelde reddeder. Sırayla:
/// 1. düz deneme, 2. hareketsiz sahte fare girdisi (son girdi bizden gelsin),
/// 3. `AttachThreadInput` hilesi.
pub fn activate(id: isize) {
    let hwnd = id_to_hwnd(id);
    unsafe {
        if IsIconic(hwnd).as_bool() {
            // Ayar açıksa pencere ikondan çıkarak açılır; animasyon iş parçacığı
            // bitince pencereyi açıp bu işlevi yeniden çağırır.
            if super::window_fx::restore_animated(id) {
                return;
            }
            let _ = ShowWindowAsync(hwnd, SW_RESTORE);
        }
        let ok = || GetForegroundWindow() == hwnd;

        if SetForegroundWindow(hwnd).as_bool() && ok() {
            log_step(1);
            return;
        }

        let nudge = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT::default(),
            },
        };
        SendInput(&[nudge], size_of::<INPUT>() as i32);
        if SetForegroundWindow(hwnd).as_bool() && ok() {
            log_step(2);
            return;
        }

        let fg_thread = GetWindowThreadProcessId(GetForegroundWindow(), None);
        let me = GetCurrentThreadId();
        let attached = fg_thread != 0
            && fg_thread != me
            && AttachThreadInput(me, fg_thread, true).as_bool();
        let _ = BringWindowToTop(hwnd);
        let _ = SetForegroundWindow(hwnd);
        if attached {
            let _ = AttachThreadInput(me, fg_thread, false);
        }
        log_step(if ok() { 3 } else { 0 });
    }
}

fn log_step(step: u8) {
    if cfg!(debug_assertions) {
        match step {
            0 => eprintln!("[focus] öne getirilemedi"),
            n => eprintln!("[focus] öne getirildi (yol {n})"),
        }
    }
}

/// Uygulamanın kendi küçültme yolunu kullanır (animasyon, kendi davranışı).
pub fn minimize(id: isize) {
    unsafe {
        let _ = PostMessageW(
            Some(id_to_hwnd(id)),
            WM_SYSCOMMAND,
            WPARAM(SC_MINIMIZE as usize),
            LPARAM(0),
        );
    }
}

pub fn close(id: isize) {
    unsafe {
        let _ = PostMessageW(Some(id_to_hwnd(id)), WM_CLOSE, WPARAM(0), LPARAM(0));
    }
}
