use std::sync::mpsc;
use std::time::Duration;

use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::config::{Config, ConfigStore};
use crate::services::apps::{AppItem, AppsService};
use crate::services::audio::{AudioCmd, AudioService, AudioState};
use crate::services::backdrop::{Backdrop, BackdropService};
use crate::services::media::{MediaCmd, MediaService, MediaState};
use crate::services::power::{PowerService, PowerState};
use crate::services::radios::{RadiosService, RadiosState, SetRadio};
use crate::services::{ics, launcher};
use crate::win::{placement, popup};

type CmdResult<T = ()> = Result<T, String>;

// --- pencere ---------------------------------------------------------------

/// Fare dock'a girince görünür bölgeyi büyütme payına açar, çıkınca bara daraltır (3.2).
#[tauri::command]
pub fn set_dock_expanded(window: WebviewWindow, expanded: bool) -> CmdResult {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    placement::set_expanded(hwnd, expanded);
    Ok(())
}

/// Windows'un kendi ayar sayfaları (radyo değiştirilemezse yedek yol, bölüm 6.7).
#[tauri::command]
pub fn open_system_settings(page: String) -> CmdResult {
    let uri = match page.as_str() {
        "wifi" => "ms-settings:network-wifi",
        "bluetooth" => "ms-settings:bluetooth",
        "sound" => "ms-settings:sound",
        "battery" => "ms-settings:batterysaver",
        _ => return Err(format!("bilinmeyen sayfa: {page}")),
    };
    launcher::open_uri(uri).map_err(Into::into)
}

/// Windows görev çubuğundaki gibi sistem panelini açar.
/// Hızlı ayarlar adresi bu makinede görev çubuğu gizliyken denendi, sağ altta açılıyor.
/// `ms-availablenetworks:` Microsoft'un ms-settings listesinde Wi-Fi ağları paneli olarak geçiyor.
/// `.../bluetooth` belgelenmemiş (kullanıcı paylaşımlarından); hızlı ayarları Bluetooth
/// listesinde açar. Kullanıcı denedi diye işaretlenene kadar şüpheli say.
#[tauri::command]
pub fn open_quick_settings(panel: String) -> CmdResult {
    let uri = match panel.as_str() {
        "wifi" => "ms-availablenetworks:",
        "bluetooth" => "ms-actioncenter:controlcenter/bluetooth",
        _ => "ms-actioncenter:controlcenter/&showFooter=true",
    };
    launcher::open_uri(uri).map_err(Into::into)
}

// --- popup (bölüm 3.4) ------------------------------------------------------

/// Dock'taki widget tıklaması: paneli aç / kapat / değiştir.
#[tauri::command]
pub fn show_popup(app: AppHandle, widget_id: String, anchor: popup::Anchor) -> CmdResult {
    popup::toggle(&app, widget_id, anchor).map_err(Into::into)
}

/// Popup sayfası paneli çizdi; şimdi konumlanıp gösterilebilir.
#[tauri::command]
pub fn popup_ready(
    app: AppHandle,
    seq: u64,
    width: f64,
    height: f64,
) -> CmdResult<Option<popup::Placed>> {
    popup::ready(&app, seq, width, height).map_err(Into::into)
}

/// Kapanış animasyonu bitti. `seq` verilirse yalnızca o açılışı kapatır.
#[tauri::command]
pub fn hide_popup(app: AppHandle, seq: Option<u64>) -> CmdResult {
    popup::hide(&app, seq).map_err(Into::into)
}

/// Windows vurgu rengi ("#rrggbb"); tema `accent: "auto"` iken kullanılır (7.9).
#[tauri::command]
pub fn get_system_accent(accent: State<crate::services::accent::AccentService>) -> Option<String> {
    accent.get()
}

// --- cam çubuk (7.2) ---------------------------------------------------------

#[tauri::command]
pub fn get_backdrop(backdrop: State<BackdropService>) -> Option<Backdrop> {
    backdrop.get()
}

// --- ayarlar ----------------------------------------------------------------

/// Pencere oluşturma Windows'ta eşzamanlı komutta kilitlenir → async.
#[tauri::command]
pub async fn open_settings(app: AppHandle, page: Option<String>) -> CmdResult {
    crate::win::settings::open_page(&app, page).map_err(Into::into)
}

/// Ayarlar sayfası yeni açıldıysa hangi bölümle başlayacağı (bir kez).
#[tauri::command]
pub fn take_settings_page() -> Option<String> {
    crate::win::settings::take_page()
}

#[tauri::command]
pub fn show_dock_menu(window: WebviewWindow) -> CmdResult {
    crate::show_dock_menu(&window).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct AutostartState {
    enabled: bool,
    /// Geliştirme sürümünde kapalı (Vite sunucusu olmadan açılamaz).
    available: bool,
}

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> AutostartState {
    AutostartState {
        enabled: crate::autostart_enabled(&app),
        available: crate::AUTOSTART_AVAILABLE,
    }
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> CmdResult<AutostartState> {
    crate::set_autostart(&app, enabled)?;
    Ok(get_autostart(app))
}

// --- takvim -----------------------------------------------------------------

/// ICS aboneliğini indirir (metin olarak). Ağ beklemesi ana iş parçacığında olmasın.
#[tauri::command]
pub async fn fetch_ics(url: String) -> CmdResult<String> {
    tauri::async_runtime::spawn_blocking(move || ics::fetch(&url))
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::into)
}

// --- config ----------------------------------------------------------------

#[tauri::command]
pub fn get_config(config: State<ConfigStore>) -> Config {
    config.get()
}

#[tauri::command]
pub fn set_config(app: AppHandle, config: State<ConfigStore>, value: Config) -> CmdResult {
    let before = config.get();
    let hide_after = value.hide_windows_taskbar;
    let fx_after = value.minimize_to_dock;
    let scale_after = value.theme.ui_scale();
    config.update(|c| *c = value).map_err(String::from)?;
    if before.theme.ui_scale() != scale_after {
        crate::win::placement::set_ui_scale(scale_after);
        if let Some(dock) = app.get_webview_window("dock")
            && let Ok(hwnd) = dock.hwnd()
        {
            crate::win::appbar::post_reposition(hwnd);
        }
    }
    if before.hide_windows_taskbar != hide_after {
        crate::apply_hide_taskbar(&app, hide_after);
    }
    if before.minimize_to_dock != fx_after {
        crate::win::window_fx::set_enabled(fx_after);
    }
    Ok(())
}

/// Uygulama ikonlarının dinlenme konumları (dock CSS pikseli); küçültme animasyonu hedefi.
#[tauri::command]
pub fn set_app_icon_rects(rects: Vec<crate::win::window_fx::IconRect>) {
    crate::win::window_fx::set_icon_rects(rects);
}

// --- uygulamalar -----------------------------------------------------------

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

// --- müzik -----------------------------------------------------------------

#[tauri::command]
pub fn get_media(media: State<MediaService>) -> Option<MediaState> {
    media.get()
}

#[tauri::command]
pub fn media_toggle(media: State<MediaService>) {
    media.send(MediaCmd::Toggle);
}

#[tauri::command]
pub fn media_next(media: State<MediaService>) {
    media.send(MediaCmd::Next);
}

#[tauri::command]
pub fn media_prev(media: State<MediaService>) {
    media.send(MediaCmd::Prev);
}

// --- ses -------------------------------------------------------------------

#[tauri::command]
pub fn get_audio(audio: State<AudioService>) -> Option<AudioState> {
    audio.get()
}

/// `v`: 0–1.
#[tauri::command]
pub fn set_volume(audio: State<AudioService>, v: f32) {
    audio.send(AudioCmd::SetVolume(v));
}

#[tauri::command]
pub fn set_mute(audio: State<AudioService>, muted: bool) {
    audio.send(AudioCmd::SetMute(muted));
}

// --- pil -------------------------------------------------------------------

#[tauri::command]
pub fn get_power(power: State<PowerService>) -> Option<PowerState> {
    power.get()
}

// --- radyolar --------------------------------------------------------------

#[tauri::command]
pub fn get_radios(radios: State<RadiosService>) -> RadiosState {
    radios.get()
}

/// `kind`: "wifi" ya da "bluetooth". Radyo değişimi bir saniye sürebilir;
/// ana iş parçacığını bekletmemek için async.
#[tauri::command]
pub async fn set_radio(radios: State<'_, RadiosService>, kind: String, on: bool) -> CmdResult {
    let wifi = match kind.as_str() {
        "wifi" => true,
        "bluetooth" => false,
        _ => return Err(format!("bilinmeyen radyo: {kind}")),
    };
    let (reply, result) = mpsc::channel();
    radios.send(SetRadio { wifi, on, reply });
    result
        .recv_timeout(Duration::from_secs(8))
        .map_err(|_| "radyo yanıt vermedi".to_string())?
}
