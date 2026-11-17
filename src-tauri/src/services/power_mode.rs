//! Güç modu (Ayarlar → Güç → Güç modu): en iyi güç verimliliği / dengeli /
//! en iyi performans.
//!
//! `powrprof.dll`'deki `PowerGetEffectiveOverlayScheme` ve
//! `PowerSetActiveOverlayScheme` Windows'un kendi kaydırıcısının kullandığı,
//! belgelenmemiş fonksiyonlar; içe aktarma kitaplığında yoklar, çalışma anında
//! `GetProcAddress` ile yüklenir. Bulunamazsa mod `None`, panel seçimi gizler.
//! Denendi (bu makinede): okuma 961CC777-… (verimlilik) döndü.
//!
//! Kimlikler yaygın kullanılan değerler: verimlilik 961CC777-…, performans
//! DED574B5-…, dengeli GUID_NULL. Mod, o anki güç kaynağı (pil / priz) için ayarlanır.

use std::sync::OnceLock;

use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows::core::{GUID, s, w};

const EFFICIENCY: GUID = GUID::from_u128(0x961cc777_2547_4f9d_8174_7d86181b8a7a);
const PERFORMANCE: GUID = GUID::from_u128(0xded574b5_45a0_4f42_8737_46345c09c238);
const BALANCED: GUID = GUID::zeroed();

type GetFn = unsafe extern "system" fn(*mut GUID) -> u32;
type SetFn = unsafe extern "system" fn(GUID) -> u32;

fn functions() -> Option<(GetFn, SetFn)> {
    static FNS: OnceLock<Option<(GetFn, SetFn)>> = OnceLock::new();
    *FNS.get_or_init(|| unsafe {
        let lib = LoadLibraryW(w!("powrprof.dll")).ok()?;
        let get = GetProcAddress(lib, s!("PowerGetEffectiveOverlayScheme"))?;
        let set = GetProcAddress(lib, s!("PowerSetActiveOverlayScheme"))?;
        // SAFETY: imzalar Windows'un kendi kullanımıyla aynı (GUID* / GUID → DWORD).
        Some((
            std::mem::transmute::<unsafe extern "system" fn() -> isize, GetFn>(get),
            std::mem::transmute::<unsafe extern "system" fn() -> isize, SetFn>(set),
        ))
    })
}

/// "efficiency", "balanced" ya da "performance".
pub fn get() -> Option<&'static str> {
    let (get, _) = functions()?;
    let mut guid = GUID::zeroed();
    if unsafe { get(&mut guid) } != 0 {
        return None;
    }
    Some(match guid {
        EFFICIENCY => "efficiency",
        PERFORMANCE => "performance",
        _ => "balanced",
    })
}

pub fn set(mode: &str) -> Result<(), String> {
    let (_, set) = functions().ok_or("güç modu bu Windows'ta desteklenmiyor")?;
    let guid = match mode {
        "efficiency" => EFFICIENCY,
        "performance" => PERFORMANCE,
        "balanced" => BALANCED,
        _ => return Err(format!("bilinmeyen güç modu: {mode}")),
    };
    match unsafe { set(guid) } {
        0 => Ok(()),
        code => Err(format!("güç modu değiştirilemedi (kod {code})")),
    }
}
