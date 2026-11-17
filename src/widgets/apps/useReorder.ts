import { useRef, useState } from "react";
import { commands, report } from "../../lib/ipc";
import type { Magnifier } from "../../lib/magnify";

/** Bu kadar kaymadan sürükleme başlamaz (tıklama sayılır). */
const THRESHOLD = 6;
/** Dock'tan bu kadar yukarı çekilip bırakılan ikon sabitten kalkar (CSS piksel). */
export const UNPIN_DISTANCE = 56;

type Drag = { id: string; from: number; dx: number; dy: number };

/**
 * Sabit ikonları basılı tutup sürükleyerek sıralama (8.7). Tarayıcının
 * sürükle-bırak API'si yerine işaretçi olayları: büyütme efektiyle çakışmaz ve
 * Tauri'nin dosya sürükleme işleyicisi HTML5 sürüklemeyi kapatıyor.
 */
export function useReorder({
  pinned,
  step,
  group,
  magnifier,
  onReorder,
}: {
  /** Sabit ikonların görünen sırası. */
  pinned: string[];
  /** Bir ikon + boşluk (CSS piksel). */
  step: number;
  group: React.RefObject<HTMLDivElement | null>;
  magnifier: React.RefObject<Magnifier | null>;
  /** Yeni sıra (Rust'a gönderilmeden önce, ekranda hemen göstermek için). */
  onReorder: (order: string[]) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const suppressClick = useRef(false);

  const targetIndex = (d: Drag) =>
    Math.max(0, Math.min(pinned.length - 1, Math.round(d.from + d.dx / step)));

  const start = (e: React.PointerEvent<HTMLElement>, id: string) => {
    const from = pinned.indexOf(id);
    if (e.button !== 0 || from < 0) return;
    const el = e.currentTarget;
    const pointer = e.pointerId;
    const sx = e.clientX;
    const sy = e.clientY;
    // İmleç ekran (zoom'lu) pikseli; dönüşümler CSS pikseli (7.9).
    const zoom = group.current?.currentCSSZoom || 1;
    let active = false;
    let last: Drag = { id, from, dx: 0, dy: 0 };

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      const dx = (ev.clientX - sx) / zoom;
      const dy = (ev.clientY - sy) / zoom;
      if (!active) {
        if (Math.hypot(dx, dy) < THRESHOLD) return;
        active = true;
        // Dock dışına çıkınca da olaylar gelsin (sabitten kaldırma).
        el.setPointerCapture(pointer);
        magnifier.current?.leave();
        commands.hidePreview().catch(report("hide_preview"));
        commands.setDockExpanded(true).catch(report("set_dock_expanded"));
      }
      last = { id, from, dx, dy };
      setDrag(last);
    };

    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!active) return;
      // Bu bırakmanın ardından gelen tıklama uygulamayı açmasın.
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false));
      setDrag(null);
      if (ev.type === "pointercancel") return;
      if (last.dy < -UNPIN_DISTANCE) {
        commands.unpinApp(id).catch(report("unpin_app"));
        return;
      }
      const to = targetIndex(last);
      if (to !== from) {
        const order = [...pinned];
        order.splice(to, 0, ...order.splice(from, 1));
        onReorder(order);
        commands.reorderPinned(order).catch(report("reorder_pinned"));
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /** Sürüklenen ve kayan ikonların dönüşümü. */
  const transform = (id: string, index: number): string | undefined => {
    if (!drag) return undefined;
    if (id === drag.id) return `translate(${drag.dx}px, ${Math.min(0, drag.dy)}px)`;
    const to = targetIndex(drag);
    if (drag.from < to && index > drag.from && index <= to) return `translateX(${-step}px)`;
    if (to < drag.from && index >= to && index < drag.from) return `translateX(${step}px)`;
    return undefined;
  };

  return {
    start,
    drag,
    transform,
    unpinning: !!drag && drag.dy < -UNPIN_DISTANCE,
    suppressClick,
  };
}
