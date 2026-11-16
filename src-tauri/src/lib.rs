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

const MENU_SETTINGS: &str = "tray:settings";
const MENU_HIDE_TASKBAR: &str = "tray:hide-taskbar";
const MENU_AUTOSTART: &str = "tray:autostart";
const MENU_QUIT: &str = "tray:quit";

/// Tepsi menüsündeki onay kutuları (durumlarını güncelleyebilmek için).
struct TrayMenu {
    /// Dock'a sağ tıklayınca da aynı menü açılır: Windows çubuğu gizliyken
    /// tepsi simgesi de onunla birlikte gizlenir.
    menu: Menu<Wry>,
    hide_taskbar: CheckMenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
}

/// Dock'un boş yerine sağ tık: tepsi menüsü imlecin olduğu yerde.
pub(crate) fn show_dock_menu(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let app = window.app_handle();
    if let Some(tray) = app.try_state::<TrayMenu>() {
        window.popup_menu(&tray.menu)?;
    }
    Ok(())
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
            commands::open_settings,
            commands::show_dock_menu,
            commands::get_backdrop,
            commands::get_autostart,
            commands::set_autostart,
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
            MENU_SETTINGS => {
                // Olay işleyicisinde pencere oluşturmak Windows'ta kilitlenir.
                let app = app.clone();
                std::thread::spawn(move || {
                    if let Err(e) = win::settings::open(&app) {
                        eprintln!("ayarlar açılamadı: {e}");
                    }
                });
            }
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
            services::backdrop::spawn(app.handle());

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

/// Tepsi (bölüm 11).
fn create_tray(app: &AppHandle, hide_taskbar: bool) -> tauri::Result<()> {
    let settings_item = MenuItem::with_id(app, MENU_SETTINGS, "Ayarlar…", true, None::<&str>)?;
    let hide_item = CheckMenuItem::with_id(
        app,
        MENU_HIDE_TASKBAR,
        "Windows görev çubuğunu gizle",
        true,
        hide_taskbar,
        None::<&str>,
    )?;
    let autostart_item = CheckMenuItem::with_id(
        app,
        MENU_AUTOSTART,
        if AUTOSTART_AVAILABLE {
            "Açılışta başlat"
        } else {
            "Açılışta başlat (yalnızca kurulu sürüm)"
        },
        AUTOSTART_AVAILABLE,
        autostart_enabled(app),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Çıkış", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &settings_item,
            &PredefinedMenuItem::separator(app)?,
            &hide_item,
            &autostart_item,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    app.manage(TrayMenu {
        menu: menu.clone(),
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

/// Geliştirme sürümü Vite sunucusu olmadan açılamaz; açılışa yalnızca
/// `tauri build` ile üretilen sürüm kaydedilsin.
pub(crate) const AUTOSTART_AVAILABLE: bool = !cfg!(debug_assertions);

pub(crate) fn autostart_enabled(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

fn toggle_autostart(app: &AppHandle) {
    if let Err(e) = set_autostart(app, !autostart_enabled(app)) {
        eprintln!("{e}");
    }
}

/// Tepsi ve ayarlar penceresi ortak yolu; tepsideki onay kutusunu da eşitler.
pub(crate) fn set_autostart(app: &AppHandle, enable: bool) -> Result<(), String> {
    if !AUTOSTART_AVAILABLE {
        return Err("açılışta başlatma yalnızca kurulu sürümde".into());
    }
    let autolaunch = app.autolaunch();
    let result = if enable {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    };
    if let Some(tray) = app.try_state::<TrayMenu>() {
        let _ = tray.autostart.set_checked(autostart_enabled(app));
    }
    result.map_err(|e| format!("açılışta başlatma ayarlanamadı: {e}"))
}
