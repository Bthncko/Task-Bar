import { useSyncExternalStore } from "react";
import { useConfig } from "./store";

// 7.7 / 7.9: hareketin azaltılıp azaltılmayacağı. Ayar "system" ise Windows'ta
// "Animasyon efektleri" kapalıyken WebView2'nin bildirdiği `prefers-reduced-motion`
// izlenir. CSS süreleri global.css'te sıfırlanır; JS ile sürülenler (büyütme,
// widget ekleme) bu kancayla kapatılır.

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const read = () => window.matchMedia(QUERY).matches;

export function useReducedMotion() {
  const system = useSyncExternalStore(subscribe, read);
  const setting = useConfig()?.theme.reduceMotion ?? "system";
  return setting === "system" ? system : setting === "reduce";
}
