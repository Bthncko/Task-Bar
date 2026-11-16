use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::error::{AppError, AppResult};

/// Mantıksal piksel. `src/styles/tokens.css` ile aynı tutulmalı.
pub const BAR_HEIGHT: f64 = 56.0;
/// Büyütülen ikonların taştığı ek pay (bölüm 3.2).
pub const MAGNIFY_PAD: f64 = 40.0;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Edge {
    Top,
    #[allow(dead_code)] // Aşama 3'te dock alta alınınca kullanılacak.
    Bottom,
}

/// Geliştirme sırasında dock ekranın üstünde; Windows çubuğuyla çakışmasın (bölüm 4.2).
/// Frontend'deki `DOCK_EDGE` ile aynı tutulmalı.
pub const EDGE: Edge = Edge::Top;

/// Dock'u birincil monitörün kenarına tam genişlikte yerleştirir.
/// `expanded` iken pencere büyütme payı kadar ekranın içine doğru uzar (Plan A).
pub fn place(window: &WebviewWindow, expanded: bool) -> AppResult<()> {
    let monitor = window.primary_monitor()?.ok_or(AppError::NoMonitor)?;
    let scale = monitor.scale_factor();
    let origin = *monitor.position();
    let size = *monitor.size();

    let logical_height = BAR_HEIGHT + if expanded { MAGNIFY_PAD } else { 0.0 };
    // Koordinatlar fiziksel piksel: DPI ölçeğiyle çarp.
    let height = (logical_height * scale).round() as u32;
    let y = match EDGE {
        Edge::Top => origin.y,
        Edge::Bottom => origin.y + size.height as i32 - height as i32,
    };

    window.set_position(PhysicalPosition::new(origin.x, y))?;
    window.set_size(PhysicalSize::new(size.width, height))?;
    Ok(())
}
