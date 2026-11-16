import { useSyncExternalStore } from "react";

// 7.7: Windows'ta "Animasyon efektleri" kapalıysa WebView2 `prefers-reduced-motion:
// reduce` bildirir. CSS süreleri global.css'te sıfırlanır; JS ile sürülenler
// (büyütme) bu kancayla kapatılır.

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const read = () => window.matchMedia(QUERY).matches;

export const useReducedMotion = () => useSyncExternalStore(subscribe, read);
