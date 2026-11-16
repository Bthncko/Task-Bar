//! Dock penceresinin Win32 genişletilmiş stilleri (bölüm 3.1).
//!
//! - `WS_EX_TOOLWINDOW`: Alt+Tab'da görünmez.
//! - `WS_EX_NOACTIVATE`: tıklayınca odağı çalmaz. (`focusable: false` da bunu
//!   ekliyor — tao 0.37 `window_state.rs` — burada ikinci kez garantiye alınıyor.)
//!
//! Tao her pencere bayrağı değişiminde (ör. `show()`) `GWL_EXSTYLE`'ı baştan
//! yazıyor ve `WS_EX_TOOLWINDOW`'u bilmiyor. Bu yüzden pencereyi alt sınıflayıp
//! `WM_STYLECHANGING` sırasında bayrakları her seferinde geri ekliyoruz.

use tauri::WebviewWindow;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    GWL_EXSTYLE, GetWindowLongPtrW, STYLESTRUCT, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOSIZE, SWP_NOZORDER, SetWindowLongPtrW, SetWindowPos, WM_STYLECHANGING, WS_EX_APPWINDOW,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

use crate::error::{AppError, AppResult};

const SUBCLASS_ID: usize = 0xD0C1;

/// Pencere gösterilmeden önce çağrılmalı (stil değişimi gizliyken kesin uygulanır).
pub fn apply_dock_style(window: &WebviewWindow) -> AppResult<()> {
    let hwnd = window.hwnd()?;
    // SAFETY: hwnd bu iş parçacığında (ana iş parçacığı) oluşturulmuş geçerli bir pencere.
    unsafe {
        if !SetWindowSubclass(hwnd, Some(keep_dock_style), SUBCLASS_ID, 0).as_bool() {
            return Err(AppError::Win32("SetWindowSubclass başarısız".into()));
        }
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, dock_ex_style(ex) as isize);
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        )?;
    }
    Ok(())
}

fn dock_ex_style(ex: u32) -> u32 {
    (ex | WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) & !WS_EX_APPWINDOW.0
}

unsafe extern "system" fn keep_dock_style(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    // WM_STYLECHANGING: wParam hangi stilin değiştiğini, lParam STYLESTRUCT'ı verir.
    if msg == WM_STYLECHANGING && wparam.0 as i32 == GWL_EXSTYLE.0 {
        // SAFETY: Windows bu mesajda lParam'da geçerli bir STYLESTRUCT işaretçisi verir.
        let style = unsafe { &mut *(lparam.0 as *mut STYLESTRUCT) };
        style.styleNew = dock_ex_style(style.styleNew);
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}
