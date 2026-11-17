//! Panellerin buzlu camı: panel açılmadan hemen önce arkasındaki ekran bölgesi
//! küçük ölçekte alınır, bulanıklaştırılır ve panelin zemini olur.
//!
//! Dock'un sahte camıyla aynı fikir (`services/backdrop.rs`), ama duvar kâğıdı
//! yerine gerçek ekran: paneller pencerelerin üstünde açılır, bulanıklık olmadan
//! arkadaki yazılar panelin yazısına karışıyordu. Görüntü açılış anındadır;
//! panel açıkken arkası değişirse (video) güncellenmez — paneller kısa ömürlü.
//!
//! GDI: ekran DC'sinden `StretchBlt` (HALFTONE) ile doğrudan küçük boyuta; tam
//! boyutlu kopya yok. Korumalı içerik (DRM video) siyah gelir, zararsız.

use std::io::Cursor;

use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::{RgbImage, imageops};
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleBitmap, CreateCompatibleDC,
    DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetDIBits, HALFTONE, HGDIOBJ, ReleaseDC,
    SRCCOPY, SelectObject, SetBrushOrgEx, SetStretchBltMode, StretchBlt,
};

/// Çalışma ölçeği: fiziksel boyutun 1/5'i.
const SCALE: i32 = 5;
/// Küçük ölçekte bulanıklık (gerçek ölçekte ≈ 5 × 5 = 25 px; Windows akriliğine yakın).
const SIGMA: f32 = 5.0;
const JPEG_QUALITY: u8 = 82;

pub struct Glass {
    /// `data:image/jpeg;base64,...`
    pub image: String,
    /// Ortalama göreli parlaklık (0–1): açık zeminde örtü koyulaşır.
    pub luma: f64,
}

/// Ekranın (x, y, w, h) fiziksel bölgesini bulanık küçük görüntü olarak döndürür.
pub fn capture(x: i32, y: i32, w: i32, h: i32) -> Option<Glass> {
    if w <= 0 || h <= 0 {
        return None;
    }
    let (sw, sh) = ((w / SCALE).max(1), (h / SCALE).max(1));
    let rgb = grab(x, y, w, h, sw, sh)?;
    let blurred = imageops::blur(&rgb, SIGMA);
    let luma = mean_luma(&blurred);
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut Cursor::new(&mut jpeg), JPEG_QUALITY)
        .encode_image(&blurred)
        .ok()?;
    Some(Glass {
        image: format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(jpeg)
        ),
        luma,
    })
}

/// Ekran bölgesini `sw`×`sh` boyutuna küçülterek okur (RGB).
fn grab(x: i32, y: i32, w: i32, h: i32, sw: i32, sh: i32) -> Option<RgbImage> {
    // SAFETY: GDI nesneleri bu işlevde oluşturulup aynı yerde bırakılır.
    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            return None;
        }
        let mem = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, sw, sh);
        let old = SelectObject(mem, HGDIOBJ(bitmap.0));
        // HALFTONE: küçültürken pikselleri ortalar (COLORONCOLOR gibi atlamaz).
        SetStretchBltMode(mem, HALFTONE);
        let _ = SetBrushOrgEx(mem, 0, 0, None);
        let copied = StretchBlt(mem, 0, 0, sw, sh, Some(screen), x, y, w, h, SRCCOPY).as_bool();

        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: sw,
                biHeight: -sh, // negatif = üstten alta
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut buf = vec![0u8; (sw * sh * 4) as usize];
        SelectObject(mem, old);
        let lines = if copied {
            GetDIBits(
                mem,
                bitmap,
                0,
                sh as u32,
                Some(buf.as_mut_ptr() as *mut _),
                &mut info,
                DIB_RGB_COLORS,
            )
        } else {
            0
        };
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        if lines == 0 {
            return None;
        }
        // BGRA → RGB.
        let rgb: Vec<u8> = buf
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|p| [p[2], p[1], p[0]])
            .collect();
        RgbImage::from_raw(sw as u32, sh as u32, rgb)
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
    /// Bu makinede (yerel deneme): ekranın sol üst köşesi okunabiliyor.
    #[test]
    #[ignore]
    fn captures_screen_region() {
        let start = std::time::Instant::now();
        let g = super::capture(0, 0, 475, 800).expect("ekran okunamadı");
        println!(
            "{} ms, luma {:.2}, {} bayt",
            start.elapsed().as_millis(),
            g.luma,
            g.image.len()
        );
        assert!(g.image.starts_with("data:image/jpeg;base64,"));
    }
}
