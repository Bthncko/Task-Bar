//! Uygulama başlatma ve Başlat menüsü (bölüm 5.5).

use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_KEYBOARD, KEYBD_EVENT_FLAGS, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput,
    VK_LWIN,
};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use windows::core::{PCWSTR, w};

use crate::error::{AppError, AppResult};
use crate::win::wide;

#[derive(Debug, Clone, PartialEq)]
pub enum LaunchTarget {
    Exe(String),
    /// Paketli (UWP / Mağaza) uygulama: `explorer.exe shell:AppsFolder\<AUMID>`.
    Aumid(String),
}

/// Paketli uygulamaların exe'si doğrudan çalıştırılamaz; onları AUMID ile başlat.
pub fn launch_target(
    exe: Option<&str>,
    aumid: Option<&str>,
    aumid_resolves: bool,
) -> Option<LaunchTarget> {
    let packaged = exe.is_none_or(|e| {
        let e = e.to_lowercase();
        e.ends_with("\\applicationframehost.exe") || e.contains("\\windowsapps\\")
    });
    match (exe, aumid) {
        (Some(exe), _) if !packaged => Some(LaunchTarget::Exe(exe.to_string())),
        (_, Some(aumid)) if aumid_resolves => Some(LaunchTarget::Aumid(aumid.to_string())),
        (Some(exe), _) => Some(LaunchTarget::Exe(exe.to_string())),
        _ => None,
    }
}

pub fn launch(target: &LaunchTarget) -> AppResult<()> {
    let (file, params) = match target {
        LaunchTarget::Exe(path) => (path.clone(), String::new()),
        LaunchTarget::Aumid(aumid) => (
            "explorer.exe".to_string(),
            format!("shell:AppsFolder\\{aumid}"),
        ),
    };
    let file_w = wide(&file);
    let params_w = wide(&params);
    let result = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            PCWSTR(file_w.as_ptr()),
            if params.is_empty() {
                PCWSTR::null()
            } else {
                PCWSTR(params_w.as_ptr())
            },
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecute: 32'den büyük değer başarı demek.
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err(AppError::Win32(format!(
            "başlatılamadı: {file} {params} (kod {})",
            result.0 as isize
        )))
    }
}

/// Windows'un kendi Başlat menüsü: Win tuşuna basıp bırak.
pub fn open_start() -> AppResult<()> {
    let key = |flags: KEYBD_EVENT_FLAGS| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VK_LWIN,
                dwFlags: flags,
                ..Default::default()
            },
        },
    };
    let inputs = [key(KEYBD_EVENT_FLAGS(0)), key(KEYEVENTF_KEYUP)];
    let sent = unsafe { SendInput(&inputs, size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err(AppError::Win32("SendInput başarısız".into()))
    }
}
