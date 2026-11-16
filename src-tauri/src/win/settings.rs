//! Ayarlar penceresi (Aşama 6): istenince oluşturulur, kapatınca yok olur.
//!
//! Doğrulanan (tauri 2.12.5 kaynağı):
//! - Windows'ta pencere oluşturmak eşzamanlı komut ya da olay işleyicisi içinde
//!   kilitlenir → çağıranlar async komut ya da ayrı iş parçacığı kullanır.
//! - HTML5 sürükle-bırak (widget sıralama) için WebView2'nin dosya bırakma
//!   işleyicisi kapatılmalı: `disable_drag_drop_handler`.

use tauri::{AppHandle, Manager, Theme, WebviewUrl, WebviewWindowBuilder};

use super::{focus, hwnd_to_id};
use crate::error::AppResult;

pub const LABEL: &str = "settings";

/// Ana iş parçacığında, eşzamanlı bir işleyicinin içinden çağırmayın (yukarıya bakın).
pub fn open(app: &AppHandle) -> AppResult<()> {
    let window = match app.get_webview_window(LABEL) {
        Some(window) => {
            if window.is_minimized()? {
                window.unminimize()?;
            }
            window.show()?;
            window
        }
        None => WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
            .title("Akıllı Dock — Ayarlar")
            .inner_size(860.0, 620.0)
            .min_inner_size(720.0, 500.0)
            .center()
            .theme(Some(Theme::Dark))
            .disable_drag_drop_handler()
            .build()?,
    };
    // Dock'tan açılınca ön plan izni bizde değil; popup'taki yolla öne getir.
    focus::activate(hwnd_to_id(window.hwnd()?));
    Ok(())
}
