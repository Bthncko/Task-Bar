use tauri::{State, WebviewWindow};

use crate::config::ConfigStore;
use crate::services::apps::{AppItem, AppsService};
use crate::services::launcher;
use crate::win::placement;

type CmdResult<T = ()> = Result<T, String>;

/// Fare dock'a girince pencereyi büyütme payı kadar uzatır, çıkınca geri alır (3.2 Plan A).
#[tauri::command]
pub fn set_dock_expanded(window: WebviewWindow, expanded: bool) -> CmdResult {
    placement::place(&window, expanded).map_err(Into::into)
}

#[tauri::command]
pub fn get_apps(apps: State<AppsService>) -> Vec<AppItem> {
    apps.items()
}

#[tauri::command]
pub fn activate_app(apps: State<AppsService>, id: String) -> CmdResult {
    apps.activate(&id).map_err(Into::into)
}

#[tauri::command]
pub fn launch_app(apps: State<AppsService>, id: String) -> CmdResult {
    apps.launch(&id).map_err(Into::into)
}

#[tauri::command]
pub fn close_window(apps: State<AppsService>, hwnd: isize) {
    apps.close_window(hwnd);
}

#[tauri::command]
pub fn pin_app(apps: State<AppsService>, config: State<ConfigStore>, id: String) -> CmdResult {
    apps.pin(&config, &id).map_err(Into::into)
}

#[tauri::command]
pub fn unpin_app(apps: State<AppsService>, config: State<ConfigStore>, id: String) -> CmdResult {
    apps.unpin(&config, &id).map_err(Into::into)
}

#[tauri::command]
pub fn show_app_menu(window: WebviewWindow, apps: State<AppsService>, id: String) -> CmdResult {
    apps.show_menu(&window, &id).map_err(Into::into)
}

#[tauri::command]
pub fn open_start() -> CmdResult {
    launcher::open_start().map_err(Into::into)
}
