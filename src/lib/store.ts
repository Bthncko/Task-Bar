import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { commands, events, report, type Config } from "./ipc";
import { withRetry } from "./retry";

// Uygulama durumu (bölüm 10). Config tek kaynaktan: Rust. Burada yalnızca son
// gelen kopya tutulur; değişiklikler `set_config` ile Rust'a gider ve
// `config://changed` ile tüm pencerelere geri döner.

type ConfigState = { config: Config | undefined };

export const useConfigStore = create<ConfigState>(() => ({ config: undefined }));

let started = false;
/** Bu pencerenin henüz Rust'a ulaşmamış bir değişikliği var mı. */
let writeTimer: number | undefined;
let writesInFlight = 0;

/** Bir kez çağrılır: ilk config'i al, sonra değişiklikleri dinle. */
export function startConfigSync() {
  if (started) return;
  started = true;
  let gotEvent = false;
  listen<Config>(events.config, (e) => {
    gotEvent = true;
    // Kendi bekleyen yazımız varken gelen ara değerler (ör. kaydırıcı
    // sürüklenirken) yerel durumu geri itmesin; son yazım zaten gelecek.
    if (writeTimer !== undefined || writesInFlight > 0) return;
    useConfigStore.setState({ config: e.payload });
  });
  // Açılışta Rust durumu henüz kaydetmemiş olabilir (lib/retry.ts).
  withRetry(commands.getConfig)
    .then((config) => {
      if (!gotEvent) useConfigStore.setState({ config });
    })
    .catch((e) => console.error("get_config", e));
}

export const useConfig = () => useConfigStore((s) => s.config);

/**
 * Config'i değiştir: bu pencerede hemen uygulanır, Rust'a `delayMs` sonra
 * yazılır (kaydırıcılar her harekette diske yazmasın). Her zaman en güncel
 * kopyadan hesaplanır.
 */
export function updateConfig(change: (c: Config) => Config, delayMs = 0) {
  const current = useConfigStore.getState().config;
  if (!current) return;
  useConfigStore.setState({ config: change(current) });
  window.clearTimeout(writeTimer);
  writeTimer = window.setTimeout(() => {
    writeTimer = undefined;
    const latest = useConfigStore.getState().config;
    if (!latest) return;
    writesInFlight++;
    commands
      .setConfig(latest)
      .catch(report("set_config"))
      .finally(() => writesInFlight--);
  }, delayMs);
}
