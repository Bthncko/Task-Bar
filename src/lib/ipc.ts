import { invoke } from "@tauri-apps/api/core";

// Rust komutlarının tipli sarmalayıcıları. Komut adları src-tauri/src/commands.rs ile aynı.

export type AppItem = {
  id: string; // gruplama anahtarı
  name: string;
  icon: string | null; // data URL
  pinned: boolean;
  windows: { hwnd: number; title: string }[];
  focused: boolean;
};

export const events = {
  apps: "apps://changed",
} as const;

export const commands = {
  /** Büyütme sırasında pencereyi bar + pay yüksekliğine açar / geri kapatır (3.2 Plan A). */
  setDockExpanded: (expanded: boolean) => invoke<void>("set_dock_expanded", { expanded }),

  getApps: () => invoke<AppItem[]>("get_apps"),
  activateApp: (id: string) => invoke<void>("activate_app", { id }),
  launchApp: (id: string) => invoke<void>("launch_app", { id }),
  closeWindow: (hwnd: number) => invoke<void>("close_window", { hwnd }),
  pinApp: (id: string) => invoke<void>("pin_app", { id }),
  unpinApp: (id: string) => invoke<void>("unpin_app", { id }),
  showAppMenu: (id: string) => invoke<void>("show_app_menu", { id }),
  openStart: () => invoke<void>("open_start"),
};

/** Komut hatalarını yutmadan konsola yazar; widget ayakta kalır. */
export function report(label: string) {
  return (e: unknown) => console.error(label, e);
}
