import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { commands, events, type Config } from "./ipc";

// Uygulama durumu (bölüm 10). Config tek kaynaktan: Rust. Burada yalnızca son
// gelen kopya tutulur; değişiklikler `set_config` ile Rust'a gider ve
// `config://changed` ile tüm pencerelere geri döner.

type ConfigState = { config: Config | undefined };

export const useConfigStore = create<ConfigState>(() => ({ config: undefined }));

let started = false;

/** Bir kez çağrılır: ilk config'i al, sonra değişiklikleri dinle. */
export function startConfigSync() {
  if (started) return;
  started = true;
  let gotEvent = false;
  listen<Config>(events.config, (e) => {
    gotEvent = true;
    useConfigStore.setState({ config: e.payload });
  });
  commands
    .getConfig()
    .then((config) => {
      if (!gotEvent) useConfigStore.setState({ config });
    })
    .catch((e) => console.error("get_config", e));
}

export const useConfig = () => useConfigStore((s) => s.config);
