import { invoke } from "@tauri-apps/api/core";

// Rust komutlarının tipli sarmalayıcıları. Komut ve olay adları
// src-tauri/src/commands.rs ve servis dosyalarıyla aynı.

// --- tipler -------------------------------------------------------------------

export type WidgetRef = { id: string };

export type PinnedApp = { id: string; name: string; exe?: string | null; aumid?: string | null };

export type AutostartState = { enabled: boolean; available: boolean };

/** Bulanık duvar kâğıdı şeridi (7.2). Yoksa düz cam. */
export type Backdrop = { image: string; luma: number } | null;

export type Config = {
  version: number;
  position: "top" | "bottom";
  hideWindowsTaskbar: boolean;
  /** Küçültülen pencere dock ikonuna girer / dock'tan açılınca çıkar. */
  minimizeToDock: boolean;
  /** Yeni sürüm çıkınca kendiliğinden indirip kur. */
  autoUpdate: boolean;
  theme: {
    /** "#rrggbb" ya da "auto" (Windows vurgu rengi). */
    accent: string;
    opacity: number;
    radius: number;
    glass: "wallpaper" | "flat";
    /** 0.85–1.25: dock ve paneller CSS zoom ile, ayrılan şerit Rust'ta. */
    scale: number;
    font: "inter" | "system";
    reduceMotion: "system" | "reduce" | "full";
  };
  layout: { left: WidgetRef[]; center: WidgetRef[]; right: WidgetRef[] };
  widgets: {
    apps: { pinned: PinnedApp[]; magnify: number; previews: boolean; previewDelayMs: number };
    weather: { lat: number; lon: number; city: string; unit: "C" | "F" };
    calendar: { icsUrls: string[] };
    clock: { showSeconds: boolean };
    system: { buttons: SystemButton[] };
  } & Record<string, unknown>;
};

/** Sistem düğmeleri (8.2); her biri Windows'un kendi panelini açar. */
export type SystemButton =
  "notifications" | "quickSettings" | "taskView" | "search" | "clipboard" | "snip" | "desktop";

/** Pencere önizlemesi (8.3). */
export type PreviewOpen = { appId: string; seq: number };
export type SourceSize = { hwnd: number; width: number; height: number };
export type ThumbRect = { hwnd: number; x: number; y: number; width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

export type AppItem = {
  id: string; // gruplama anahtarı
  name: string;
  icon: string | null; // data URL
  pinned: boolean;
  windows: { hwnd: number; title: string }[];
  focused: boolean;
};

export type MediaState = {
  title: string;
  artist: string;
  artwork: string | null;
  playing: boolean;
  canPrev: boolean;
  canNext: boolean;
  sourceApp: string;
  /** Karıştırma; oynatıcı desteklemiyorsa null. */
  shuffle: boolean | null;
  /** Tekrar kipi; oynatıcı desteklemiyorsa null. */
  repeat: RepeatMode | null;
} | null;

export type RepeatMode = "off" | "list" | "track";

export type AudioState = { volume: number; muted: boolean; device: string } | null;

export type PowerState = {
  percent: number;
  plugged: boolean;
  charging: boolean;
  /** Enerji / pil tasarrufu açık. */
  saver: boolean;
} | null;

export type RadioInfo = { on: boolean; disabled: boolean };
export type RadiosState = {
  wifi: RadioInfo | null;
  bluetooth: RadioInfo | null;
  ssid: string | null;
  signal: number | null;
};

export type SpotifyStatus = {
  clientId: string;
  connected: boolean;
  /** Bağlı hesabın görünen adı. */
  account: string | null;
  /** Spotify panelinde kayıtlı olması gereken yönlendirme adresi. */
  redirectUri: string;
};

export type QueueItem = {
  uri: string;
  title: string;
  artist: string;
  image: string | null;
  durationMs: number;
};

export type SpotifyQueue = { current: QueueItem | null; items: QueueItem[] };

export type UpdateStatus =
  | { state: "idle" | "checking" | "upToDate" }
  | { state: "available"; version: string }
  | { state: "downloading"; version: string; percent: number }
  | { state: "installing"; version: string }
  | { state: "error"; message: string };

export type UpdateInfo = { current: string; status: UpdateStatus };

// --- olaylar ------------------------------------------------------------------

export const events = {
  config: "config://changed",
  apps: "apps://changed",
  media: "media://changed",
  audio: "audio://changed",
  power: "power://changed",
  radios: "radios://changed",
  backdrop: "backdrop://changed",
  /** Windows vurgu rengi değişti ("#rrggbb" | null). */
  accent: "accent://changed",
  /** Tam ekran uygulama açıldı (true) / kapandı (false). */
  fullscreen: "fullscreen://changed",
  /** Yalnızca popup penceresine: hangi panel çizilecek. */
  popupOpen: "popup://open",
  popupClosed: "popup://closed",
  /** Rust kapanma istiyor (odak kaybı, ikinci tıklama): animasyonla kapat. */
  popupClose: "popup://close",
  /** Yalnızca önizleme penceresine: hangi uygulamanın pencereleri (PreviewOpen). */
  previewOpen: "preview://open",
  previewClosed: "preview://closed",
  /** Önizlemesi açık uygulama (`null`: kapalı); dock isim balonunu gizler. */
  previewState: "preview://state",
  /** Açık ayarlar penceresi: bu bölüme geç. */
  settingsPage: "settings://page",
  /** Spotify bağlandı / bağlantı kesildi ya da düştü (SpotifyStatus). */
  spotify: "spotify://changed",
  /** Güncelleme durumu (UpdateInfo). */
  update: "update://status",
} as const;

export type PopupOpen = { widgetId: string; seq: number };
/** `popup_ready` yanıtı: tıklanan widget'ın ortası, panelin sol kenarından (CSS px). */
export type PopupPlaced = { originX: number } | null;

// --- komutlar -----------------------------------------------------------------

export const commands = {
  /** Büyütme sırasında görünür bölgeyi açar / bara daraltır (3.2). */
  setDockExpanded: (expanded: boolean) => invoke<void>("set_dock_expanded", { expanded }),
  openSystemSettings: (page: "wifi" | "bluetooth" | "sound" | "battery" | "spotify-dashboard") =>
    invoke<void>("open_system_settings", { page }),
  /** Windows'un hızlı ayarlar paneli; "wifi" doğrudan ağ listesini açar. */
  openQuickSettings: (panel: "wifi" | "bluetooth" | "battery") =>
    invoke<void>("open_quick_settings", { panel }),

  /** Widget'ın panelini aç / kapat. `anchor`: widget'ın dock'taki yatay konumu (CSS px). */
  showPopup: (widgetId: string, anchor: { x: number; width: number }) =>
    invoke<void>("show_popup", { widgetId, anchor }),
  /** Popup sayfası paneli çizdi; boyut mantıksal piksel. */
  popupReady: (seq: number, width: number, height: number) =>
    invoke<PopupPlaced>("popup_ready", { seq, width, height }),
  /** Kapanış animasyonu bitti; `seq` verilirse yalnızca o açılış kapanır. */
  hidePopup: (seq?: number) => invoke<void>("hide_popup", { seq: seq ?? null }),

  /** ICS aboneliğini metin olarak indirir (CORS yüzünden Rust'ta). */
  fetchIcs: (url: string) => invoke<string>("fetch_ics", { url }),

  /** `page`: açılınca gösterilecek bölüm (ör. "weather"). */
  openSettings: (page?: string) => invoke<void>("open_settings", { page: page ?? null }),
  takeSettingsPage: () => invoke<string | null>("take_settings_page"),
  /** Dock'un boş yerine sağ tık: tepsi menüsü. */
  showDockMenu: () => invoke<void>("show_dock_menu"),
  getBackdrop: () => invoke<Backdrop>("get_backdrop"),
  getSystemAccent: () => invoke<string | null>("get_system_accent"),
  getAutostart: () => invoke<AutostartState>("get_autostart"),
  setAutostart: (enabled: boolean) => invoke<AutostartState>("set_autostart", { enabled }),

  getConfig: () => invoke<Config>("get_config"),
  setConfig: (value: Config) => invoke<void>("set_config", { value }),

  getApps: () => invoke<AppItem[]>("get_apps"),
  activateApp: (id: string) => invoke<void>("activate_app", { id }),
  launchApp: (id: string) => invoke<void>("launch_app", { id }),
  closeWindow: (hwnd: number) => invoke<void>("close_window", { hwnd }),
  pinApp: (id: string) => invoke<void>("pin_app", { id }),
  unpinApp: (id: string) => invoke<void>("unpin_app", { id }),
  showAppMenu: (id: string) => invoke<void>("show_app_menu", { id }),
  /** İkonların dinlenme konumları (dock CSS pikseli): küçültme animasyonunun hedefi. */
  setAppIconRects: (rects: { id: string; x: number; y: number; size: number }[]) =>
    invoke<void>("set_app_icon_rects", { rects }),
  openStart: () => invoke<void>("open_start"),

  /** İmleç açık penceresi olan bir ikona girdi; `anchor`: ikonun dock'taki yeri (CSS px). */
  previewEnter: (appId: string, anchor: { x: number; width: number }) =>
    invoke<void>("preview_enter", { appId, anchor }),
  previewLeave: () => invoke<void>("preview_leave"),
  previewHover: (inside: boolean) => invoke<void>("preview_hover", { inside }),
  previewSizes: (seq: number, hwnds: number[]) =>
    invoke<SourceSize[]>("preview_sizes", { seq, hwnds }),
  /** Kartlar dizildi: pencereyi konumla, küçük resimleri yerleştir, göster. */
  previewLayout: (seq: number, width: number, height: number, thumbs: ThumbRect[], clip: Rect) =>
    invoke<void>("preview_layout", { seq, width, height, thumbs, clip }),
  hidePreview: () => invoke<void>("hide_preview"),
  activateWindow: (hwnd: number) => invoke<void>("activate_window", { hwnd }),
  systemShortcut: (action: SystemButton) => invoke<void>("system_shortcut", { action }),

  getMedia: () => invoke<MediaState>("get_media"),
  mediaToggle: () => invoke<void>("media_toggle"),
  mediaNext: () => invoke<void>("media_next"),
  mediaPrev: () => invoke<void>("media_prev"),
  mediaSetShuffle: (on: boolean) => invoke<void>("media_set_shuffle", { on }),
  mediaSetRepeat: (mode: RepeatMode) => invoke<void>("media_set_repeat", { mode }),

  spotifyStatus: () => invoke<SpotifyStatus>("spotify_status"),
  /** Tarayıcıda Spotify onayını bekler (en çok 3 dk). */
  spotifyConnect: (clientId: string) => invoke<SpotifyStatus>("spotify_connect", { clientId }),
  spotifyDisconnect: () => invoke<SpotifyStatus>("spotify_disconnect"),
  spotifyQueue: () => invoke<SpotifyQueue>("spotify_queue"),
  /** Sıradakilerdeki öğeyi doğrudan çal (`index` 0 = sıradaki). */
  spotifyPlayItem: (index: number, uri: string) =>
    invoke<void>("spotify_play_item", { index, uri }),

  getUpdateInfo: () => invoke<UpdateInfo>("get_update_info"),
  /** Sonuç `events.update` ile gelir; yeni sürüm varsa kurulur (uygulama yeniden açılır). */
  checkUpdate: () => invoke<void>("check_update"),

  getAudio: () => invoke<AudioState>("get_audio"),
  /** v: 0–1 */
  setVolume: (v: number) => invoke<void>("set_volume", { v }),
  setMute: (muted: boolean) => invoke<void>("set_mute", { muted }),

  getPower: () => invoke<PowerState>("get_power"),

  getRadios: () => invoke<RadiosState>("get_radios"),
  setRadio: (kind: "wifi" | "bluetooth", on: boolean) => invoke<void>("set_radio", { kind, on }),
};

/** Komut hatalarını yutmadan konsola yazar; widget ayakta kalır. */
export function report(label: string) {
  return (e: unknown) => console.error(label, e);
}
