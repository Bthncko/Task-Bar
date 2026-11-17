//! Tepsi taşma penceresini ("gizli simgeler", 8.6) dock'taki tepsi düğmesinin
//! tam üstüne taşır.
//!
//! Pencere Explorer'ın; Windows onu gizli çubuktaki okun yerine göre açar.
//! Açıldıktan sonra konumu `SetWindowPos` ile değiştirilir (aynı bütünlük
//! düzeyindeki başka sürecin penceresi: izin var). Görünümü değiştirilemez;
//! içerik ve menüler Windows'un.

use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::RECT;
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowW, GetWindowRect, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER, SetWindowPos,
};
use windows::core::w;

use super::placement::{self, EDGE, Edge};
use crate::error::{AppError, AppResult};

/// Bar ile pencere arası (popup ile aynı, mantıksal piksel).
const GAP: f64 = 10.0;
const MARGIN: f64 = 8.0;
/// Pencere açıldıktan sonra Windows'un kendi konumlamasını bitirmesi için.
const SETTLE: Duration = Duration::from_millis(120);
const WAIT: Duration = Duration::from_millis(900);

/// Düğmenin dock penceresindeki yatay konumu (CSS piksel).
#[derive(Deserialize, Clone, Copy)]
pub struct Anchor {
    x: f64,
    width: f64,
}

/// Taşma penceresini aç ve düğmenin üstüne taşı.
pub fn open(app: &AppHandle, anchor: Anchor) -> AppResult<()> {
    crate::services::launcher::open_tray()?;
    let start = Instant::now();
    while start.elapsed() < WAIT {
        let hwnd = unsafe { FindWindowW(w!("TopLevelWindowForOverflowXamlIsland"), None) };
        if let Ok(hwnd) = hwnd
            && !hwnd.is_invalid()
        {
            std::thread::sleep(SETTLE);
            return place(app, hwnd, anchor);
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    Ok(())
}

fn place(
    app: &AppHandle,
    overflow: windows::Win32::Foundation::HWND,
    anchor: Anchor,
) -> AppResult<()> {
    let dock = app
        .get_webview_window("dock")
        .ok_or(AppError::NoDockWindow)?;
    let dock_hwnd = dock.hwnd()?;
    let scale = placement::scale(dock_hwnd);
    let mut dock_rect = RECT::default();
    let mut rect = RECT::default();
    unsafe {
        GetWindowRect(dock_hwnd, &mut dock_rect)?;
        GetWindowRect(overflow, &mut rect)?;
    }
    let bar = placement::reserved_rect().unwrap_or(dock_rect);
    let (w, h) = (rect.right - rect.left, rect.bottom - rect.top);
    let gap = (GAP * scale).round() as i32;
    let margin = (MARGIN * scale).round() as i32;
    let center = dock_rect.left + ((anchor.x + anchor.width / 2.0) * scale).round() as i32;
    let monitor = placement::monitor_rect_at(center, (bar.top + bar.bottom) / 2);
    let x = (center - w / 2).clamp(
        monitor.left + margin,
        (monitor.right - margin - w).max(monitor.left + margin),
    );
    let y = match EDGE {
        Edge::Bottom => bar.top - gap - h,
        Edge::Top => bar.bottom + gap,
    };
    unsafe {
        SetWindowPos(
            overflow,
            None,
            x,
            y,
            0,
            0,
            SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        )?;
    }
    Ok(())
}
