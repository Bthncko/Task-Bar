import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands, events, report, type PopupOpen } from "../lib/ipc";
import { startConfigSync, useConfig } from "../lib/store";
import { applyTheme } from "../lib/theme";
import { registry } from "../widgets/registry";
import styles from "./PopupWindow.module.css";

const DEFAULT_SIZE = { width: 320, height: 360 };

startConfigSync();

/**
 * Tek popup penceresi (bölüm 3.4). Rust hangi widget'ın panelini istediğini
 * `popup://open` ile söyler; panel çizilince `popup_ready` ile boyutu bildiririz,
 * Rust ancak o zaman konumlayıp gösterir (eski içerik görünmesin).
 */
export function PopupWindow() {
  const config = useConfig();
  const [open, setOpen] = useState<PopupOpen | null>(null);
  const announced = useRef(0);

  useEffect(() => {
    const unlisten = [
      listen<PopupOpen>(events.popupOpen, (e) => setOpen(e.payload)),
      listen(events.popupClosed, () => setOpen(null)),
    ];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") commands.hidePopup().catch(report("hide_popup"));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      unlisten.forEach((p) => p.then((off) => off()));
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (config) applyTheme(config.theme);
  }, [config?.theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const widget = open ? registry[open.widgetId] : undefined;
  const Popup = widget?.Popup;

  // DOM güncellendi → Rust'a "göster" de; her açılışta bir kez.
  // (requestAnimationFrame değil: pencere gizliyken kare üretilmeyebilir.)
  useLayoutEffect(() => {
    if (!open || !config || !widget?.Popup || announced.current === open.seq) return;
    announced.current = open.seq;
    const size = widget.popupSize ?? DEFAULT_SIZE;
    commands.popupReady(open.seq, size.width, size.height).catch(report("popup_ready"));
  });

  if (!open || !config || !widget || !Popup) return null;
  const widgetConfig = config.widgets[open.widgetId] ?? widget.defaultConfig;

  return (
    // Her açılışta yeni örnek: önceki açılıştan kalan durum (ör. gezilen ay) sıfırlanır.
    <div key={open.seq} className={styles.panel}>
      <Popup config={widgetConfig} />
    </div>
  );
}
