import { commands, report } from "./ipc";

/** Dock'taki bir widget'ın panelini açar / kapatır (bölüm 3.4). */
export function togglePopup(widgetId: string, el: Element) {
  const r = el.getBoundingClientRect();
  commands.showPopup(widgetId, { x: r.left, width: r.width }).catch(report("show_popup"));
}
