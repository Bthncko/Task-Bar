//! Cam çubuk için bulanık duvar kâğıdı şeridi (PLAN-ASAMA-7 7.2, B bölümü 1. yol).
//!
//! Duvar kâğıdını birincil monitöre Windows'un yerleştirdiği gibi (doldur,
//! sığdır, uzat, ortala, döşe) küçük ölçekte yeniden çizer, bulanıklaştırır ve
//! çubuğun ayırdığı şeridi kırpar. Frontend bunu CSS arka planı olarak kullanır;
//! şekil (köşe, kenar, taşan ikonlar) tamamen CSS'te kalır.
//!
//! Doğrulananlar:
//! - `IDesktopWallpaper` (Microsoft Learn): monitör kimliği NULL verilirse ve
//!   monitörlerde farklı resim / slayt gösterisi varsa boş dize döner → birincil
//!   monitörün kimliği açıkça verilir. Düz renkte de yol boş → `GetBackgroundColor`.
//!   Konum değerleri: CENTER, TILE, STRETCH, FIT, FILL, SPAN.
//! - Bu makinede yol `%APPDATA%\Microsoft\Windows\Themes\TranscodedWallpaper`
//!   (uzantısız JPEG); yol alınamaz ya da dosya yoksa o yedek olarak denenir.
//!   Bu yedek belgelenmiş değil, gözlem.
//!
//! Değişim: 5 sn'de bir yol + dosya değişim zamanı + monitör/şerit karşılaştırılır;
//! yalnızca fark varsa yeniden üretilir.
//!
//! Hareketli duvar kâğıdı (Wallpaper Engine, Lively…): bu uygulamalar kendi
//! pencerelerini masaüstünün (`Progman`/`WorkerW`) içine yerleştirir; Windows ise
//! eski resmi bildirmeye devam eder (bu makinede görüldü: `WPEVideoWallpaper`).
//! O zaman sahte cam yanlış resmi gösterir → kapatılır, çubuk gerçekten yarı
//! saydam olur ve arkada hareketli duvar kâğıdı görünür (B bölümü 3. yol).

use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::{self, FilterType};
use image::{ImageReader, Rgb, RgbImage};
use serde::Serialize;
use tauri::AppHandle;
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::System::Com::{CLSCTX_ALL, CoCreateInstance};
use windows::Win32::UI::Shell::{
    DESKTOP_WALLPAPER_POSITION, DWPOS_CENTER, DWPOS_FIT, DWPOS_STRETCH, DWPOS_TILE,
    DesktopWallpaper, IDesktopWallpaper,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, EnumWindows, GetClassNameW, GetWindowThreadProcessId, IsWindowVisible,
};
use windows::core::BOOL;
use windows::core::PCWSTR;

use super::runner;
use crate::error::{AppError, AppResult};
use crate::win::{placement, take_pwstr, wide};

pub const BACKDROP_CHANGED: &str = "backdrop://changed";
const POLL: Duration = Duration::from_secs(5);
/// Çalışma ölçeği: monitörün 1/6'sı. Bulanıklık burada ucuz.
const SCALE: f64 = 1.0 / 6.0;
/// Küçük ölçekte bulanıklık (gerçek ölçekte ≈ 6 × 6 = 36 px).
const SIGMA: f32 = 6.0;
const JPEG_QUALITY: u8 = 85;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Backdrop {
    /// Çubuğun ayrılan şeridi (tam genişlik), `data:image/jpeg;base64,...`
    pub image: String,
    /// Şeridin ortalama parlaklığı, 0–1. Cam opaklığı buna göre ayarlanır.
    pub luma: f64,
}

pub type BackdropService = runner::ServiceHandle<Option<Backdrop>, ()>;

/// Yeniden üretmeyi gerektiren her şey.
#[derive(Debug, Clone, PartialEq)]
struct Source {
    path: Option<PathBuf>,
    modified: Option<SystemTime>,
    position: DESKTOP_WALLPAPER_POSITION,
    /// COLORREF: 0x00BBGGRR
    color: u32,
    monitor: RECT,
    strip: RECT,
    /// Masaüstünde hareketli duvar kâğıdı penceresi var.
    live: bool,
}

pub fn spawn(app: &AppHandle) {
    runner::spawn(app, "backdrop", BACKDROP_CHANGED, POLL, None, |_| {
        let mut last: Option<Source> = None;
        let mut cached: Option<Backdrop> = None;
        move |_: Option<()>| {
            // Dock henüz yerleşmediyse bekle.
            let strip = placement::reserved_rect()?;
            let source = match read_source(strip) {
                Ok(s) => s,
                Err(e) => {
                    log(&format!("duvar kâğıdı okunamadı: {e}"));
                    return cached.clone();
                }
            };
            if last.as_ref() != Some(&source) {
                cached = if source.live {
                    log("hareketli duvar kâğıdı var: sahte cam kapalı, çubuk yarı saydam");
                    None
                } else {
                    match render(&source) {
                        Ok(b) => {
                            log(&format!(
                                "şerit üretildi: {:?}, konum {}, parlaklık {:.2}",
                                source.path.as_deref().map(|p| p.display().to_string()),
                                source.position.0,
                                b.luma
                            ));
                            Some(b)
                        }
                        Err(e) => {
                            // Düz cama düşer (frontend arka plan yoksa yarı saydam renk).
                            log(&format!("şerit üretilemedi: {e}"));
                            None
                        }
                    }
                };
                last = Some(source);
            }
            cached.clone()
        }
    });
}

fn log(msg: &str) {
    if cfg!(debug_assertions) {
        eprintln!("[backdrop] {msg}");
    }
}

fn read_source(strip: RECT) -> AppResult<Source> {
    let monitor = placement::primary_monitor_rect();
    // SAFETY: COM bu iş parçacığında runner tarafından başlatıldı.
    let (path, position, color) = unsafe {
        let dw: IDesktopWallpaper = CoCreateInstance(&DesktopWallpaper, None, CLSCTX_ALL)?;
        let id = primary_monitor_id(&dw);
        let id_w = id.as_deref().map(wide);
        let id_ptr = id_w.as_ref().map_or(PCWSTR::null(), |w| PCWSTR(w.as_ptr()));
        let path = take_pwstr(dw.GetWallpaper(id_ptr)?);
        (path, dw.GetPosition()?, dw.GetBackgroundColor()?.0)
    };

    let path = Some(PathBuf::from(&path))
        .filter(|p| !p.as_os_str().is_empty() && p.is_file())
        .or_else(transcoded_wallpaper);
    let modified = path
        .as_ref()
        .and_then(|p| std::fs::metadata(p).ok())
        .and_then(|m| m.modified().ok());

    Ok(Source {
        path,
        modified,
        position,
        color,
        monitor,
        strip,
        live: live_wallpaper_active(),
    })
}

/// Masaüstü pencerelerinin (`Progman` / `WorkerW`) içinde Explorer'a ait
/// olmayan görünür bir pencere var mı.
fn live_wallpaper_active() -> bool {
    unsafe extern "system" fn top(hwnd: HWND, lparam: LPARAM) -> BOOL {
        // SAFETY: lparam aşağıdaki `found` değişkenine işaret ediyor.
        let found = unsafe { &mut *(lparam.0 as *mut bool) };
        let mut buf = [0u16; 32];
        let len = unsafe { GetClassNameW(hwnd, &mut buf) }.max(0) as usize;
        let class = String::from_utf16_lossy(&buf[..len]);
        if class == "Progman" || class == "WorkerW" {
            let mut shell = 0u32;
            unsafe { GetWindowThreadProcessId(hwnd, Some(&mut shell)) };
            let mut ctx = (shell, false);
            let _ = unsafe {
                EnumChildWindows(Some(hwnd), Some(child), LPARAM(&mut ctx as *mut _ as isize))
            };
            if ctx.1 {
                *found = true;
                return false.into(); // aramayı bitir
            }
        }
        true.into()
    }
    unsafe extern "system" fn child(hwnd: HWND, lparam: LPARAM) -> BOOL {
        // SAFETY: lparam yukarıdaki `ctx` çiftine işaret ediyor.
        let ctx = unsafe { &mut *(lparam.0 as *mut (u32, bool)) };
        if unsafe { IsWindowVisible(hwnd) }.as_bool() {
            let mut pid = 0u32;
            unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
            if pid != 0 && pid != ctx.0 {
                ctx.1 = true;
                return false.into();
            }
        }
        true.into()
    }

    let mut found = false;
    // Erken bitirmede Err döner; sonucu `found` taşır.
    let _ = unsafe { EnumWindows(Some(top), LPARAM(&mut found as *mut bool as isize)) };
    found
}

/// Birincil monitör her zaman (0,0)'da başlar; ölçü/DPI karşılaştırmasına gerek yok.
unsafe fn primary_monitor_id(dw: &IDesktopWallpaper) -> Option<String> {
    let count = unsafe { dw.GetMonitorDevicePathCount() }.ok()?;
    for i in 0..count {
        let Ok(raw) = (unsafe { dw.GetMonitorDevicePathAt(i) }) else {
            continue;
        };
        let id = unsafe { take_pwstr(raw) };
        let id_w = wide(&id);
        if let Ok(r) = unsafe { dw.GetMonitorRECT(PCWSTR(id_w.as_ptr())) }
            && r.left == 0
            && r.top == 0
        {
            return Some(id);
        }
    }
    None
}

fn transcoded_wallpaper() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    let p = PathBuf::from(appdata).join(r"Microsoft\Windows\Themes\TranscodedWallpaper");
    p.is_file().then_some(p)
}

fn render(src: &Source) -> AppResult<Backdrop> {
    let mw = (src.monitor.right - src.monitor.left).max(1) as f64;
    let mh = (src.monitor.bottom - src.monitor.top).max(1) as f64;
    let w = (mw * SCALE).round().max(1.0) as u32;
    let h = (mh * SCALE).round().max(1.0) as u32;

    let [r, g, b, _] = src.color.to_le_bytes();
    let mut canvas = RgbImage::from_pixel(w, h, Rgb([r, g, b]));
    if let Some(path) = &src.path {
        let img = ImageReader::open(path)?
            .with_guessed_format()?
            .decode()
            .map_err(|e| AppError::Win32(format!("resim çözülemedi: {e}")))?
            .to_rgb8();
        place(&mut canvas, &img, src.position);
    }

    // Tüm ekranı bulanıklaştırıp sonra kırp: şeridin üst/alt kenarında kararma olmaz.
    let blurred = imageops::blur(&canvas, SIGMA);
    let y0 = (((src.strip.top - src.monitor.top) as f64) * SCALE)
        .floor()
        .max(0.0) as u32;
    let y1 = ((((src.strip.bottom - src.monitor.top) as f64) * SCALE).ceil() as u32).min(h);
    let strip =
        imageops::crop_imm(&blurred, 0, y0.min(h - 1), w, y1.saturating_sub(y0).max(1)).to_image();

    let luma = mean_luma(&strip);
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY)
        .encode_image(&strip)
        .map_err(|e| AppError::Win32(format!("JPEG yazılamadı: {e}")))?;
    Ok(Backdrop {
        image: format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(jpeg)
        ),
        luma,
    })
}

/// Duvar kâğıdını küçük tuvale Windows'un konum kuralıyla yerleştirir.
fn place(canvas: &mut RgbImage, img: &RgbImage, position: DESKTOP_WALLPAPER_POSITION) {
    let (cw, ch) = canvas.dimensions();
    let (iw, ih) = img.dimensions();
    if iw == 0 || ih == 0 {
        return;
    }
    let scaled = |s: f64| {
        let sw = ((iw as f64) * s).round().max(1.0) as u32;
        let sh = ((ih as f64) * s).round().max(1.0) as u32;
        imageops::resize(img, sw, sh, FilterType::Triangle)
    };
    let centered = |canvas: &mut RgbImage, part: &RgbImage| {
        let x = (cw as i64 - part.width() as i64) / 2;
        let y = (ch as i64 - part.height() as i64) / 2;
        imageops::overlay(canvas, part, x, y);
    };
    let fit = (cw as f64 / iw as f64).min(ch as f64 / ih as f64);
    let fill = (cw as f64 / iw as f64).max(ch as f64 / ih as f64);

    match position {
        DWPOS_STRETCH => {
            let part = imageops::resize(img, cw, ch, FilterType::Triangle);
            imageops::overlay(canvas, &part, 0, 0);
        }
        DWPOS_FIT => centered(canvas, &scaled(fit)),
        // Gerçek boyutunda (fiziksel piksel) → tuval ölçeğinde.
        DWPOS_CENTER => centered(canvas, &scaled(SCALE)),
        DWPOS_TILE => {
            let tile = scaled(SCALE);
            for y in (0..ch).step_by(tile.height() as usize) {
                for x in (0..cw).step_by(tile.width() as usize) {
                    imageops::overlay(canvas, &tile, x as i64, y as i64);
                }
            }
        }
        // FILL ve SPAN (yalnızca birincil monitör, bölüm F) — en yaygın.
        _ => centered(canvas, &scaled(fill)),
    }
}

/// Ortalama göreli parlaklık (sRGB ağırlıkları, 0–1).
fn mean_luma(img: &RgbImage) -> f64 {
    let n = (img.width() * img.height()).max(1) as f64;
    let sum: f64 = img
        .pixels()
        .map(|p| 0.2126 * p[0] as f64 + 0.7152 * p[1] as f64 + 0.0722 * p[2] as f64)
        .sum();
    sum / n / 255.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> RECT {
        RECT {
            left,
            top,
            right,
            bottom,
        }
    }

    fn source(path: Option<PathBuf>, position: DESKTOP_WALLPAPER_POSITION, color: u32) -> Source {
        Source {
            path,
            modified: None,
            position,
            color,
            monitor: rect(0, 0, 1920, 1080),
            // Alt kenarda 80 px'lik şerit (%125'te 64 px).
            strip: rect(0, 1000, 1920, 1080),
            live: false,
        }
    }

    #[test]
    fn fill_keeps_aspect_and_crops_sides() {
        // Üst yarı kırmızı, alt yarı mavi; 3:1 → 16:9 tuvalde yanlardan kırpılır.
        let img = RgbImage::from_fn(300, 100, |_, y| {
            if y < 50 {
                Rgb([255, 0, 0])
            } else {
                Rgb([0, 0, 255])
            }
        });
        let mut canvas = RgbImage::from_pixel(160, 90, Rgb([0, 255, 0]));
        place(&mut canvas, &img, windows::Win32::UI::Shell::DWPOS_FILL);
        assert_eq!(canvas.get_pixel(80, 5), &Rgb([255, 0, 0]));
        assert_eq!(canvas.get_pixel(80, 85), &Rgb([0, 0, 255]));
        // Doldurmada arka plan rengi hiç görünmez.
        assert!(canvas.pixels().all(|p| p[1] == 0));
    }

    #[test]
    fn fit_letterboxes_with_background() {
        let img = RgbImage::from_pixel(300, 100, Rgb([255, 255, 255]));
        let mut canvas = RgbImage::from_pixel(160, 90, Rgb([0, 0, 0]));
        place(&mut canvas, &img, DWPOS_FIT);
        assert_eq!(canvas.get_pixel(80, 45), &Rgb([255, 255, 255]));
        assert_eq!(canvas.get_pixel(80, 2), &Rgb([0, 0, 0]));
    }

    #[test]
    fn bright_wallpaper_gives_high_luma() {
        let path = std::env::temp_dir().join("akilli-dock-test-white.png");
        RgbImage::from_pixel(640, 360, Rgb([250, 250, 250]))
            .save(&path)
            .unwrap();
        let b = render(&source(
            Some(path.clone()),
            windows::Win32::UI::Shell::DWPOS_FILL,
            0,
        ))
        .unwrap();
        let _ = std::fs::remove_file(path);
        assert!(b.image.starts_with("data:image/jpeg;base64,"));
        assert!(b.luma > 0.95, "luma {}", b.luma);
    }

    #[test]
    fn solid_color_without_image() {
        // COLORREF 0x00BBGGRR: saf mavi.
        let b = render(&source(None, DWPOS_CENTER, 0x00FF_0000)).unwrap();
        assert!((b.luma - 0.0722).abs() < 0.02, "luma {}", b.luma);
    }
}
