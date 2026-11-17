//! Uygulama başlatma ve Başlat menüsü (bölüm 5.5).

use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_KEYBOARD, KEYBD_EVENT_FLAGS, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput,
    VIRTUAL_KEY, VK_LWIN,
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

/// AUMID, Başlat'taki uygulamalar listesinde (`shell:AppsFolder`) varsa her zaman
/// onunla başlat. Paketli uygulamaların exe'si doğrudan çalışmaz; tarayıcıdaki web
/// uygulamalarının (Edge/Chrome PWA, Firefox web uygulaması) exe'si ise yalnızca
/// düz tarayıcıyı açar. Exe yalnızca AUMID çözülmezse kullanılır.
pub fn launch_target(
    exe: Option<&str>,
    aumid: Option<&str>,
    aumid_resolves: bool,
) -> Option<LaunchTarget> {
    match (exe, aumid) {
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

/// `ms-settings:` gibi bir adresi kabuğa açtırır.
pub fn open_uri(uri: &str) -> AppResult<()> {
    let uri_w = wide(uri);
    let result = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            PCWSTR(uri_w.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err(AppError::Win32(format!("açılamadı: {uri}")))
    }
}

/// Windows'un kendi Başlat menüsü: Win tuşuna basıp bırak.
pub fn open_start() -> AppResult<()> {
    send_chord(&[VK_LWIN])
}

/// Tuş kombinasyonu gönderir (8.1): tuşlar sırayla basılır, ters sırayla
/// bırakılır. Ör. bildirim merkezi `send_chord(&[VK_LWIN, VK_N])`.
pub fn send_chord(keys: &[VIRTUAL_KEY]) -> AppResult<()> {
    let key = |vk: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                dwFlags: flags,
                ..Default::default()
            },
        },
    };
    let inputs: Vec<INPUT> = keys
        .iter()
        .map(|&vk| key(vk, KEYBD_EVENT_FLAGS(0)))
        .chain(keys.iter().rev().map(|&vk| key(vk, KEYEVENTF_KEYUP)))
        .collect();
    let sent = unsafe { SendInput(&inputs, size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err(AppError::Win32("SendInput başarısız".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_app_launches_by_aumid_not_browser() {
        let edge = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
        assert_eq!(
            launch_target(Some(edge), Some("Facebook.InstagramBeta_x!App"), true),
            Some(LaunchTarget::Aumid("Facebook.InstagramBeta_x!App".into()))
        );
    }

    #[test]
    fn falls_back_to_exe_when_aumid_unknown() {
        let code = r"C:\Code\Code.exe";
        assert_eq!(
            launch_target(Some(code), Some("Some.Window.Id"), false),
            Some(LaunchTarget::Exe(code.into()))
        );
        assert_eq!(
            launch_target(Some(code), None, false),
            Some(LaunchTarget::Exe(code.into()))
        );
        assert_eq!(launch_target(None, Some("x"), false), None);
    }
}
