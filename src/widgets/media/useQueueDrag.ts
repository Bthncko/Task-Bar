import { useRef, useState } from "react";

/** Bu kadar kaymadan sürükleme başlamaz (tıklama sayılır). */
const THRESHOLD = 5;
/** Listenin üst / alt kenarına bu kadar yaklaşınca liste kayar (CSS piksel). */
const EDGE = 36;
const SCROLL_STEP = 10;

type Drag = { from: number; dy: number };

/**
 * Sıradakiler listesinde basılı tutup sürükleyerek sıralama. Dock'taki ikon
 * sıralamasıyla aynı yol (işaretçi olayları, `apps/useReorder.ts`): Tauri'nin
 * dosya sürükleme işleyicisi HTML5 sürüklemeyi kapatıyor.
 */
export function useQueueDrag({
  count,
  list,
  disabled,
  onDrop,
}: {
  count: number;
  list: React.RefObject<HTMLOListElement | null>;
  disabled: boolean;
  /** `from` → `to` (görünen sıradaki yerler). */
  onDrop: (from: number, to: number) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const suppressClick = useRef(false);
  const step = useRef(48);

  const targetIndex = (d: Drag) =>
    Math.max(0, Math.min(count - 1, Math.round(d.from + d.dy / step.current)));

  const start = (e: React.PointerEvent<HTMLElement>, from: number) => {
    // Satırdaki eylem düğmeleri sürüklemeyi başlatmaz.
    if (disabled || e.button !== 0 || (e.target as Element).closest("[data-no-drag]")) return;
    const el = e.currentTarget;
    const box = list.current;
    const pointer = e.pointerId;
    const sy = e.clientY;
    // İmleç ekran (zoom'lu) pikseli; dönüşümler CSS pikseli.
    const zoom = el.currentCSSZoom || 1;
    const scroll0 = box?.scrollTop ?? 0;
    step.current = el.offsetHeight || 48;
    let active = false;
    let last: Drag = { from, dy: 0 };

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      const raw = (ev.clientY - sy) / zoom;
      if (!active) {
        if (Math.abs(raw) < THRESHOLD) return;
        active = true;
        try {
          el.setPointerCapture(pointer);
        } catch {
          // İşaretçi bu arada bırakıldıysa yakalama gerekmez.
        }
      }
      // Kenara yaklaşınca listeyi kaydır; kayma da sürüklemeye eklenir.
      if (box) {
        const r = box.getBoundingClientRect();
        const y = ev.clientY;
        if (y < r.top + EDGE * zoom) box.scrollTop -= SCROLL_STEP;
        else if (y > r.bottom - EDGE * zoom) box.scrollTop += SCROLL_STEP;
      }
      const scrolled = (box?.scrollTop ?? 0) - scroll0;
      last = { from, dy: raw + scrolled };
      setDrag(last);
    };

    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!active) return;
      // Bırakmanın ardından gelen tıklama şarkıyı çalmasın.
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false));
      setDrag(null);
      if (ev.type === "pointercancel") return;
      const to = targetIndex(last);
      if (to !== from) onDrop(from, to);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /** Sürüklenen ve kayan satırların dönüşümü. */
  const transform = (index: number): string | undefined => {
    if (!drag) return undefined;
    if (index === drag.from) return `translateY(${drag.dy}px)`;
    const to = targetIndex(drag);
    const s = step.current;
    if (drag.from < to && index > drag.from && index <= to) return `translateY(${-s}px)`;
    if (to < drag.from && index >= to && index < drag.from) return `translateY(${s}px)`;
    return undefined;
  };

  return { start, drag, transform, suppressClick };
}
