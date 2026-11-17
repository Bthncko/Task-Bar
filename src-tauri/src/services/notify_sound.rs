//! Bildirim sesi: Windows'un bildirim olaylarına kendi seslerimiz.
//!
//! - Kaynak kayıt defteri (ayar dosyası yok, Windows'tan değiştirilirse de
//!   doğru görünür): `HKCU\AppEvents\Schemes\Apps\.Default\<olay>\.Current`
//!   varsayılan değeri = wav yolu. Windows bildirim sesini her çalışta buradan
//!   okur (uygulama bildirimleri ve dock'un `PlaySound("Notification.Default")`).
//! - Windows'un kendi sesi aynı olayın `.Default` alt anahtarında; geri
//!   yüklemek onu `.Current`'a kopyalamak.
//! - Mesaj / posta / takvim uygulamaları kendi olaylarını kullanır (IM, Mail,
//!   Reminder, SMS): beşi birlikte değişir. Kendi sesini kendisi çalan
//!   uygulamalar (Discord vb.) etkilenmez.
//! - Sesler `sounds/generate.py` ile sıfırdan sentezlendi, programa gömülü;
//!   seçilince `%LOCALAPPDATA%\AkilliDock\Sounds\<id>.wav`'a yazılır (Windows
//!   dosya yolu ister).

use std::path::PathBuf;

use windows::Win32::Media::Audio::{
    PlaySoundW, SND_ASYNC, SND_FILENAME, SND_MEMORY, SND_NODEFAULT,
};
use windows::core::{HSTRING, PCWSTR};
use windows_registry::CURRENT_USER;

const SCHEMES: &str = r"AppEvents\Schemes\Apps\.Default";
const EVENTS: [&str; 5] = [
    "Notification.Default",
    "Notification.IM",
    "Notification.Mail",
    "Notification.Reminder",
    "Notification.SMS",
];
pub const WINDOWS: &str = "windows";
/// Kayıt defterinde tanımadığımız bir ses (kullanıcı Windows'tan seçmiş).
pub const CUSTOM: &str = "custom";

const SOUNDS: &[(&str, &[u8])] = &[
    ("damla", include_bytes!("../../sounds/damla.wav")),
    ("esinti", include_bytes!("../../sounds/esinti.wav")),
    ("cakil", include_bytes!("../../sounds/cakil.wav")),
    ("kristal", include_bytes!("../../sounds/kristal.wav")),
    ("can", include_bytes!("../../sounds/can.wav")),
];

fn wav(id: &str) -> Option<&'static [u8]> {
    SOUNDS.iter().find(|(i, _)| *i == id).map(|(_, w)| *w)
}

fn sounds_dir() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    Some(PathBuf::from(base).join("AkilliDock").join("Sounds"))
}

/// Olayın `sub` alt anahtarındaki ses yolu ("" = sessiz).
fn read(event: &str, sub: &str) -> Option<String> {
    CURRENT_USER
        .open(format!(r"{SCHEMES}\{event}\{sub}"))
        .ok()?
        .get_string("")
        .ok()
}

/// Şu an seçili ses: kendi seslerimizden biri, `WINDOWS` ya da `CUSTOM`.
pub fn current() -> String {
    let event = EVENTS[0];
    let Some(path) = read(event, ".Current") else {
        return WINDOWS.into();
    };
    let default = read(event, ".Default").unwrap_or_default();
    if path.is_empty() || expand(&path).eq_ignore_ascii_case(&expand(&default)) {
        return WINDOWS.into();
    }
    let path = PathBuf::from(expand(&path));
    let ours = sounds_dir().is_some_and(|d| path.parent().is_some_and(|p| p == d));
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match stem.as_str() {
        _ if !ours => CUSTOM.into(),
        // İlk elle kurulan ses (8.5) bu adla yazılmıştı; "can" ile aynı.
        "bildirim" => "can".into(),
        s if wav(s).is_some() => s.into(),
        _ => CUSTOM.into(),
    }
}

/// Seçili ses kendi seslerimizden biri mi (uygulama seslerini o zaman dock çalar).
pub fn is_ours() -> bool {
    wav(&current()).is_some()
}

/// Sesi seç: beş bildirim olayına yazar. `WINDOWS`: Windows'un kendi sesleri.
pub fn set(id: &str) -> Result<(), String> {
    let fail = |e: windows::core::Error| format!("Ses ayarlanamadı: {}", e.message());
    if id == WINDOWS {
        for event in EVENTS {
            let base = format!(r"{SCHEMES}\{event}");
            let Ok(default) = CURRENT_USER
                .open(format!(r"{base}\.Default"))
                .and_then(|k| k.get_value(""))
            else {
                continue;
            };
            for sub in [".Current", ".Modified"] {
                CURRENT_USER
                    .create(format!(r"{base}\{sub}"))
                    .and_then(|k| k.set_value("", &default))
                    .map_err(fail)?;
            }
        }
        super::notifications::set_own_sound(false);
        return Ok(());
    }
    let data = wav(id).ok_or_else(|| format!("Bilinmeyen ses: {id}"))?;
    let dir = sounds_dir().ok_or("Uygulama veri klasörü bulunamadı.")?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Ses klasörü açılamadı: {e}"))?;
    let path = dir.join(format!("{id}.wav"));
    if std::fs::read(&path).ok().as_deref() != Some(data) {
        std::fs::write(&path, data).map_err(|e| format!("Ses dosyası yazılamadı: {e}"))?;
    }
    let path = path.to_string_lossy().into_owned();
    for event in EVENTS {
        for sub in [".Current", ".Modified"] {
            CURRENT_USER
                .create(format!(r"{SCHEMES}\{event}\{sub}"))
                .and_then(|k| k.set_string("", &path))
                .map_err(fail)?;
        }
    }
    super::notifications::set_own_sound(true);
    Ok(())
}

/// Bir kez çal (ayarlardaki "Dinle"). Hemen döner.
pub fn preview(id: &str) {
    if let Some(data) = wav(id) {
        // SAFETY: veri programa gömülü ('static), eşzamansız çalış sürerken geçerli.
        unsafe {
            let _ = PlaySoundW(
                PCWSTR(data.as_ptr().cast()),
                None,
                SND_MEMORY | SND_ASYNC | SND_NODEFAULT,
            );
        }
        return;
    }
    let path = if id == WINDOWS {
        read(EVENTS[0], ".Default")
    } else {
        read(EVENTS[0], ".Current")
    };
    if let Some(path) = path.filter(|p| !p.is_empty()) {
        let path = HSTRING::from(expand(&path));
        // SAFETY: SND_ASYNC dosya adını çağrı içinde kopyalar.
        unsafe {
            let _ = PlaySoundW(&path, None, SND_FILENAME | SND_ASYNC | SND_NODEFAULT);
        }
    }
}

/// "%SystemRoot%\media\x.wav" → "C:\WINDOWS\media\x.wav".
fn expand(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                match std::env::var(name) {
                    Ok(v) if !name.is_empty() => out.push_str(&v),
                    _ => out.push_str(&rest[start..start + end + 2]),
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sounds_are_valid_wavs() {
        for (id, data) in SOUNDS {
            assert_eq!(&data[..4], b"RIFF", "{id}");
            assert_eq!(&data[8..12], b"WAVE", "{id}");
            // 48 kHz, 16 bit, mono; 1,2 sn'den kısa.
            assert_eq!(u32::from_le_bytes(data[24..28].try_into().unwrap()), 48_000);
            assert!(data.len() < 48_000 * 2 * 12 / 10, "{id}");
        }
    }

    #[test]
    fn expands_environment() {
        let root = std::env::var("SystemRoot").unwrap();
        assert_eq!(
            expand(r"%SystemRoot%\media\a.wav"),
            format!(r"{root}\media\a.wav")
        );
        assert_eq!(expand(r"C:\a%b.wav"), r"C:\a%b.wav");
        assert_eq!(
            expand("%YOK_BOYLE_BIR_DEGISKEN%x"),
            "%YOK_BOYLE_BIR_DEGISKEN%x"
        );
    }

    /// Bu makinede (yerel deneme): şu anki ses okunuyor; hiçbir şey yazılmaz.
    #[test]
    #[ignore]
    fn reads_current() {
        println!("şu anki: {}", current());
    }
}
