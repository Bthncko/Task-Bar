//! Uygulama adı ve ikonu, kabuk öğesi üzerinden (bölüm 5.3).
//!
//! Tek yol: `SHCreateItemFromParsingName` → AUMID için `shell:AppsFolder\<AUMID>`,
//! yoksa exe yolu → `IShellItemImageFactory::GetImage` → PNG → base64 data URL.
//! Çağıran iş parçacığında COM başlatılmış olmalı.

use std::io::Cursor;

use base64::Engine;
use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, DeleteObject, GetDC, GetDIBits,
    GetObjectW, HBITMAP, HGDIOBJ, ReleaseDC,
};
use windows::Win32::Storage::EnhancedStorage::PKEY_FileDescription;
use windows::Win32::UI::Shell::{
    IShellItem, IShellItem2, IShellItemImageFactory, SHCreateItemFromParsingName,
    SIGDN_NORMALDISPLAY, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY,
};
use windows::core::{Interface, PCWSTR};

use crate::win::{take_pwstr, wide};

/// İkon kenar uzunluğu (fiziksel piksel). Büyütülmüş ikon 72 mantıksal px × ölçek.
const ICON_PX: i32 = 128;

pub struct ShellInfo {
    pub name: Option<String>,
    pub icon: Option<String>,
    /// AUMID kabukta (Başlat menüsü uygulamaları) kayıtlı mı.
    pub aumid_resolves: bool,
}

pub fn shell_info(aumid: Option<&str>, exe: Option<&str>) -> ShellInfo {
    let from_aumid = aumid.and_then(|a| parse(&format!("shell:AppsFolder\\{a}")));
    let aumid_resolves = from_aumid.is_some();
    let (item, is_exe) = match from_aumid {
        Some(item) => (Some(item), false),
        None => (exe.and_then(parse), true),
    };
    let Some(item) = item else {
        return ShellInfo {
            name: None,
            icon: None,
            aumid_resolves,
        };
    };
    ShellInfo {
        name: display_name(&item, is_exe),
        icon: icon_data_url(&item),
        aumid_resolves,
    }
}

fn parse(path: &str) -> Option<IShellItem> {
    let w = wide(path);
    unsafe { SHCreateItemFromParsingName(PCWSTR(w.as_ptr()), None).ok() }
}

fn display_name(item: &IShellItem, is_exe: bool) -> Option<String> {
    unsafe {
        if is_exe {
            // Exe için "chrome.exe" yerine sürüm bilgisindeki açıklama ("Google Chrome").
            if let Ok(item2) = item.cast::<IShellItem2>() {
                if let Ok(p) = item2.GetString(&PKEY_FileDescription) {
                    let s = take_pwstr(p);
                    if !s.trim().is_empty() {
                        return Some(s.trim().to_string());
                    }
                }
            }
        }
        let s = take_pwstr(item.GetDisplayName(SIGDN_NORMALDISPLAY).ok()?);
        let s = if is_exe {
            s.strip_suffix(".exe").unwrap_or(&s).to_string()
        } else {
            s
        };
        (!s.is_empty()).then_some(s)
    }
}

fn icon_data_url(item: &IShellItem) -> Option<String> {
    unsafe {
        let factory = item.cast::<IShellItemImageFactory>().ok()?;
        let bitmap = factory
            .GetImage(
                SIZE {
                    cx: ICON_PX,
                    cy: ICON_PX,
                },
                SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK,
            )
            .ok()?;
        let rgba = bitmap_to_rgba(bitmap);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let (w, h, pixels) = rgba?;
        let mut image = image::RgbaImage::from_raw(w, h, pixels)?;
        // SIIGBF_BIGGERSIZEOK daha büyüğünü (çoğu zaman 256) döndürebilir; en
        // büyük gösterim 72 px (40 × 1.8), 128 yeter ve bellekte 4 kat küçük (7.4).
        if w > ICON_PX as u32 || h > ICON_PX as u32 {
            image = image::imageops::resize(
                &image,
                ICON_PX as u32,
                ICON_PX as u32,
                image::imageops::FilterType::CatmullRom,
            );
        }
        let mut png = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
            .ok()?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(png);
        Some(format!("data:image/png;base64,{b64}"))
    }
}

/// HBITMAP → üstten alta RGBA piksel dizisi.
unsafe fn bitmap_to_rgba(bitmap: HBITMAP) -> Option<(u32, u32, Vec<u8>)> {
    unsafe {
        let mut bm = BITMAP::default();
        if GetObjectW(
            HGDIOBJ(bitmap.0),
            size_of::<BITMAP>() as i32,
            Some(&mut bm as *mut BITMAP as *mut _),
        ) == 0
        {
            return None;
        }
        let (w, h) = (bm.bmWidth, bm.bmHeight.abs());
        if w <= 0 || h <= 0 {
            return None;
        }
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // negatif = üstten alta
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut buf = vec![0u8; (w * h * 4) as usize];
        let dc = GetDC(None);
        let lines = GetDIBits(
            dc,
            bitmap,
            0,
            h as u32,
            Some(buf.as_mut_ptr() as *mut _),
            &mut info,
            DIB_RGB_COLORS,
        );
        ReleaseDC(None, dc);
        if lines == 0 {
            return None;
        }
        fix_alpha_and_swizzle(&mut buf);
        Some((w as u32, h as u32, buf))
    }
}

/// BGRA → RGBA. Alfa kanalı boşsa (eski 24 bit ikonlar) opak yapar; önceden
/// çarpılmış (premultiplied) alfa ise düz alfaya çevirir.
fn fix_alpha_and_swizzle(buf: &mut [u8]) {
    let all_transparent = buf.chunks_exact(4).all(|p| p[3] == 0);
    let premultiplied = !all_transparent
        && buf
            .chunks_exact(4)
            .all(|p| p[0] <= p[3] && p[1] <= p[3] && p[2] <= p[3]);
    for p in buf.chunks_exact_mut(4) {
        p.swap(0, 2);
        if all_transparent {
            p[3] = 255;
        } else if premultiplied && p[3] > 0 && p[3] < 255 {
            let a = p[3] as u32;
            for c in &mut p[..3] {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
}
