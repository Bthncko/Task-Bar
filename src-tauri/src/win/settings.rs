//! Ayarlar penceresi (Aşama 6): istenince oluşturulur, kapatınca yok olur.
//!
//! Doğrulanan (tauri 2.12.5 kaynağı):
//! - Windows'ta pencere oluşturmak eşzamanlı komut ya da olay işleyicisi içinde
//!   kilitlenir → çağıranlar async komut ya da ayrı iş parçacığı kullanır.
//! - HTML5 sürükle-bırak (widget sıralama) için WebView2'nin dosya bırakma
//!   işleyicisi kapatılmalı: `disable_drag_drop_handler`.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Theme, WebviewUrl, WebviewWindowBuilder};

use super::{focus, hwnd_to_id};
use crate::error::AppResult;

pub const LABEL: &str = "settings";
/// Açık ayarlar penceresine: şu bölüme geç.
const PAGE_EVENT: &str = "settings://page";

/// Yeni oluşturulan pencerenin ilk bölümü: sayfa yüklenince `take_page` ile alır
/// (olay o sırada henüz dinlenmiyor olabilir).
static PENDING_PAGE: Mutex<Option<String>> = Mutex::new(None);

pub fn take_page() -> Option<String> {
    PENDING_PAGE.lock().unwrap().take()
}

/// `open`, belirli bir bölümle (ör. "weather"). Aynı kısıtlar geçerli.
pub fn open_page(app: &AppHandle, page: Option<String>) -> AppResult<()> {
    let existed = app.get_webview_window(LABEL).is_some();
    if !existed {
        *PENDING_PAGE.lock().unwrap() = page.clone();
    }
    open(app)?;
    if existed && let Some(page) = page {
        app.emit_to(LABEL, PAGE_EVENT, page)?;
    }
    Ok(())
}

fn title() -> String {
    format!(
        "{} — {}",
        crate::i18n::app_name(),
        crate::i18n::t("Ayarlar")
    )
}

/// Dil değişince açık ayarlar penceresinin başlığını yeniler.
pub fn refresh_title(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.set_title(&title());
    }
}

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
            .title(title())
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
