import { invoke } from "@tauri-apps/api/core";

// Rust komutlarının tipli sarmalayıcıları. Komut ve olay adları
// src-tauri/src/commands.rs ve servis dosyalarıyla aynı.

// --- tipler -------------------------------------------------------------------

export type WidgetRef = { id: string };

export type Config = {
  version: number;
  position: "top" | "bottom";
  hideWindowsTaskbar: boolean;
  theme: { accent: string; opacity: number; radius: number };
  layout: { left: WidgetRef[]; center: WidgetRef[]; right: WidgetRef[] };
  widgets: {
    apps: { pinned: unknown[]; magnify: number };
    weather: { lat: number; lon: number; city: string; unit: "C" | "F" };
    calendar: { icsUrls: string[] };
  } & Record<string, unknown>;
};

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
} | null;

export type AudioState = { volume: number; muted: boolean; device: string } | null;

export type PowerState = { percent: number; plugged: boolean; charging: boolean } | null;

export type RadioInfo = { on: boolean; disabled: boolean };
export type RadiosState = {
  wifi: RadioInfo | null;
  bluetooth: RadioInfo | null;
  ssid: string | null;
  signal: number | null;
};

// --- olaylar ------------------------------------------------------------------

export const events = {
  config: "config://changed",
  apps: "apps://changed",
  media: "media://changed",
  audio: "audio://changed",
  power: "power://changed",
  radios: "radios://changed",
} as const;

// --- komutlar -----------------------------------------------------------------

export const commands = {
  /** Büyütme sırasında görünür bölgeyi açar / bara daraltır (3.2). */
  setDockExpanded: (expanded: boolean) => invoke<void>("set_dock_expanded", { expanded }),
  openSystemSettings: (page: "wifi" | "bluetooth" | "sound" | "battery") =>
    invoke<void>("open_system_settings", { page }),
  /** Windows'un hızlı ayarlar paneli; "wifi" doğrudan ağ listesini açar. */
  openQuickSettings: (panel: "wifi" | "bluetooth" | "battery") =>
    invoke<void>("open_quick_settings", { panel }),

  getConfig: () => invoke<Config>("get_config"),
  setConfig: (value: Config) => invoke<void>("set_config", { value }),

  getApps: () => invoke<AppItem[]>("get_apps"),
  activateApp: (id: string) => invoke<void>("activate_app", { id }),
  launchApp: (id: string) => invoke<void>("launch_app", { id }),
  closeWindow: (hwnd: number) => invoke<void>("close_window", { hwnd }),
  pinApp: (id: string) => invoke<void>("pin_app", { id }),
  unpinApp: (id: string) => invoke<void>("unpin_app", { id }),
  showAppMenu: (id: string) => invoke<void>("show_app_menu", { id }),
  openStart: () => invoke<void>("open_start"),

  getMedia: () => invoke<MediaState>("get_media"),
  mediaToggle: () => invoke<void>("media_toggle"),
  mediaNext: () => invoke<void>("media_next"),
  mediaPrev: () => invoke<void>("media_prev"),

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
