import { useSyncExternalStore } from "react";

/**
 * Dock çubuğu ekranda mı (tam ekran uygulamada ya da otomatik gizlenmede
 * değil). Sürekli güncellenen şeyler (pil dalgası, saniyeli saat) görünmezken
 * durur: pencere gizliyken de sayfa kare üretip GPU'yu meşgul ediyordu (ör.
 * tam ekran oyun sırasında). Görünür olunca kaldıkları yerden devam ederler.
 */
let visible = true;
const listeners = new Set<() => void>();

export function setDockVisible(next: boolean) {
  if (next === visible) return;
  visible = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDockVisible() {
  return useSyncExternalStore(subscribe, () => visible);
}
