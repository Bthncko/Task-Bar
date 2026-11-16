//! Akıllı Dock — yalnızca Windows 11 için.

mod commands;
mod config;
mod error;
mod services;
mod win;

use std::sync::mpsc;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

use config::ConfigStore;
use error::AppError;
use services::apps::{self, AppsService};

const MENU_HIDE_TASKBAR: &str = "tray:hide-taskbar";
const MENU_AUTOSTART: &str = "tray:autostart";
const MENU_QUIT: &str = "tray:quit";

/// Tepsi menüsündeki onay kutuları (durumlarını güncelleyebilmek için).
struct TrayMenu {
    hide_taskbar: CheckMenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Çökmede de sistemi geri ver: AppBar'ı kaldır, Windows çubuğunu göster.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        win::shutdown();
        default_hook(info);
    }));

    let app = tauri::Builder::default()
        // Tek örnek: dokümana göre ilk kaydedilen eklenti olmalı.
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {
            // İkinci kopya açılmaz; ilk kopya zaten ekranda.
        }))
        .invoke_handler(tauri::generate_handler![
            commands::set_dock_expanded,
            commands::open_system_settings,
            commands::open_quick_settings,
            commands::show_popup,
            commands::popup_ready,
            commands::hide_popup,
            commands::fetch_ics,
            commands::get_config,
            commands::set_config,
            commands::get_apps,
            commands::activate_app,
            commands::launch_app,
            commands::close_window,
            commands::pin_app,
            commands::unpin_app,
            commands::show_app_menu,
            commands::open_start,
            commands::get_media,
            commands::media_toggle,
            commands::media_next,
            commands::media_prev,
            commands::get_audio,
            commands::set_volume,
            commands::set_mute,
            commands::get_power,
            commands::get_radios,
            commands::set_radio,
        ])
        // Tüm menü olayları (tepsi + sağ tık menüleri) buraya gelir.
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_QUIT => app.exit(0),
            MENU_HIDE_TASKBAR => toggle_hide_taskbar(app),
            MENU_AUTOSTART => toggle_autostart(app),
            id => apps::handle_menu_event(app, id),
        })
        .setup(|app| {
            app.handle()
                .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))?;

            let config_dir = app.path().app_config_dir()?;
            let config = ConfigStore::load(config_dir.clone());
            config.attach(app.handle().clone());
            let hide_taskbar = config.get().hide_windows_taskbar;
            app.manage(config);

            let (wake_tx, wake_rx) = mpsc::channel();
            app.manage(AppsService::new(wake_tx));
            apps::spawn_poller(app.handle().clone(), wake_rx);
            services::media::spawn(app.handle());
            services::audio::spawn(app.handle());
            services::power::spawn(app.handle());
            services::radios::spawn(app.handle());

            let dock = app
                .get_webview_window("dock")
                .ok_or(AppError::NoDockWindow)?;
            let hwnd = dock.hwnd()?;
            win::window_style::apply_dock_style(&dock)?;
            win::appbar::register(app.handle(), hwnd)?;
            win::placement::reposition(hwnd)?;
            dock.show()?;
            win::popup::init(app.handle())?;

            // Önceki çökmeden kalan gizli çubuğu da burada onarır.
            win::taskbar::init(config_dir, hide_taskbar);

            create_tray(app.handle(), hide_taskbar)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Akıllı Dock başlatılamadı");

    app.run(|_app, event| {
        if let RunEvent::Exit = event {
            win::shutdown();
        }
    });
}

/// Tepsi (bölüm 11). "Ayarlar" Aşama 6'da eklenecek.
fn create_tray(app: &AppHandle, hide_taskbar: bool) -> tauri::Result<()> {
    let hide_item = CheckMenuItem::with_id(
        app,
        MENU_HIDE_TASKBAR,
        "Windows görev çubuğunu gizle",
        true,
        hide_taskbar,
        None::<&str>,
    )?;
    // Geliştirme sürümü Vite sunucusu olmadan açılamaz; açılışa yalnızca
    // `tauri build` ile üretilen sürüm kaydedilsin.
    let release = !cfg!(debug_assertions);
    let autostart_item = CheckMenuItem::with_id(
        app,
        MENU_AUTOSTART,
        if release {
            "Açılışta başlat"
        } else {
            "Açılışta başlat (yalnızca kurulu sürüm)"
        },
        release,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Çıkış", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &hide_item,
            &autostart_item,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    app.manage(TrayMenu {
        hide_taskbar: hide_item,
        autostart: autostart_item,
    });

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

fn toggle_hide_taskbar(app: &AppHandle) {
    let config = app.state::<ConfigStore>();
    let hide = !config.get().hide_windows_taskbar;
    if let Err(e) = config.update(|c| c.hide_windows_taskbar = hide) {
        eprintln!("ayar kaydedilemedi: {e}");
    }
    apply_hide_taskbar(app, hide);
}

/// Windows çubuğunu gizle/göster ve tepsideki onay kutusunu eşitle.
/// (Ayar kaydını çağıran yapar: tepsi ya da `set_config`.)
pub(crate) fn apply_hide_taskbar(app: &AppHandle, hide: bool) {
    win::taskbar::set_hidden(hide);
    if let Some(tray) = app.try_state::<TrayMenu>() {
        let _ = tray.hide_taskbar.set_checked(hide);
    }
}

fn toggle_autostart(app: &AppHandle) {
    let autolaunch = app.autolaunch();
    let enable = !autolaunch.is_enabled().unwrap_or(false);
    let result = if enable {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    };
    if let Err(e) = result {
        eprintln!("açılışta başlatma ayarlanamadı: {e}");
    }
    let enabled = autolaunch.is_enabled().unwrap_or(false);
    let _ = app.state::<TrayMenu>().autostart.set_checked(enabled);
}
