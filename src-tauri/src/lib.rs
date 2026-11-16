//! Akıllı Dock — yalnızca Windows 11 için.

mod commands;
mod config;
mod error;
mod services;
mod win;

use std::sync::mpsc;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

use config::ConfigStore;
use error::AppError;
use services::apps::{self, AppsService};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::set_dock_expanded,
            commands::get_apps,
            commands::activate_app,
            commands::launch_app,
            commands::close_window,
            commands::pin_app,
            commands::unpin_app,
            commands::show_app_menu,
            commands::open_start,
        ])
        // Tüm menü olayları (tepsi + sağ tık menüleri) buraya gelir.
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == "quit" {
                app.exit(0);
            } else {
                apps::handle_menu_event(app, id);
            }
        })
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            app.manage(ConfigStore::load(config_dir));

            let (wake_tx, wake_rx) = mpsc::channel();
            app.manage(AppsService::new(wake_tx));
            apps::spawn_poller(app.handle().clone(), wake_rx);

            let dock = app
                .get_webview_window("dock")
                .ok_or(AppError::NoDockWindow)?;
            win::placement::place(&dock, false)?;
            win::window_style::apply_dock_style(&dock)?;
            dock.show()?;

            create_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Akıllı Dock başlatılamadı");
}

/// Tepsi ikonu: şimdilik yalnızca Çıkış (bölüm 11; diğer öğeler sonraki aşamalarda).
fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let quit = MenuItem::with_id(app, "quit", "Çıkış", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Akıllı Dock")
        .menu(&menu)
        .show_menu_on_left_click(true);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
