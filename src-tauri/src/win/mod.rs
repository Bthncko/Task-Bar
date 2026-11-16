pub mod focus;
pub mod placement;
pub mod window_style;

use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::core::PWSTR;

/// Sonu sıfırlı UTF-16 dize.
pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// COM'un ayırdığı dizeyi Rust'a kopyalar ve belleği serbest bırakır.
///
/// # Safety
/// `p`, `CoTaskMemAlloc` ile ayrılmış geçerli bir dize olmalı.
pub unsafe fn take_pwstr(p: PWSTR) -> String {
    let s = unsafe { p.to_string() }.unwrap_or_default();
    unsafe { CoTaskMemFree(Some(p.0 as *const _)) };
    s
}

/// HWND'yi JSON'a ve geri taşımak için sayıya çevirir.
pub fn hwnd_to_id(h: HWND) -> isize {
    h.0 as isize
}

pub fn id_to_hwnd(id: isize) -> HWND {
    HWND(id as *mut _)
}
