// Dock büyütme efekti (bölüm 5.6).
//
// React state kullanılmaz: her karede ref'ler üzerinden doğrudan style yazılır.
// Ölçek, imleç ile her ikonun DİNLENME konumundaki merkezi arasındaki uzaklıktan
// hesaplanır; böylece ikonlar genişledikçe hesap kendi kendini beslemez (titreme yok).
// rAF döngüsü yalnızca hareket sürerken çalışır, durunca kendini kapatır.

export interface MagnifyOptions {
  base: number; // ikon boyu (px)
  gap: number; // ikonlar arası boşluk (px)
  max: number; // en büyük ölçek (1.8 → 40px ikon 72px olur)
  range: number; // etkinin söndüğü uzaklık (px)
  smoothingMs: number; // hedefe yaklaşma zaman sabiti
}

export interface Magnifier {
  setSlots(slots: HTMLElement[]): void;
  move(clientX: number): void;
  leave(): void;
  destroy(): void;
}

export function magnifyScale(distance: number, max: number, range: number): number {
  const t = Math.min(Math.abs(distance) / range, 1);
  const c = Math.cos((Math.PI / 2) * t);
  return 1 + (max - 1) * c * c;
}

/**
 * Odak noktası `f` (dinlenme düzenindeki koordinat) için büyümüş düzende o
 * noktanın vardığı konum. İkonlar `f`'ye uzaklıklarına göre büyür; boşluklar sabit.
 */
function magnifiedPosition(f: number, count: number, o: MagnifyOptions): number {
  const step = o.base + o.gap;
  let left = 0;
  for (let i = 0; i < count; i++) {
    const restStart = i * step;
    const w = o.base * magnifyScale(restStart + o.base / 2 - f, o.max, o.range);
    if (f < restStart + o.base) return left + (Math.max(f - restStart, 0) / o.base) * w;
    if (f < restStart + step) return left + w + (f - restStart - o.base);
    left += w + o.gap;
  }
  return left + (f - count * step);
}

/**
 * İmlecin altında kalması gereken dinlenme noktasını bulur: büyümüş düzende
 * imlecin tam altına düşen `f`. Sola yaslı grupta solundaki ikonlar büyüdükçe
 * hedef ikon imlecin altından kaymasın diye. Konum `f`'ye göre artan olduğundan
 * ikiye bölme (bisection) yeterli.
 */
function focusForCursor(x: number, count: number, o: MagnifyOptions): number {
  const total = count * (o.base + o.gap);
  let lo = -o.range;
  let hi = total + o.range * o.max;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (magnifiedPosition(mid, count, o) < x) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function createMagnifier(container: HTMLElement, opts: MagnifyOptions): Magnifier {
  let slots: HTMLElement[] = [];
  let current: number[] = [];
  let target: number[] = [];
  let frame = 0;
  let last = 0;

  const write = () => {
    for (let i = 0; i < slots.length; i++) {
      const s = current[i];
      const slot = slots[i];
      // Genişlik değişir ki komşular itilsin; görsel büyüme iç öğede transform ile.
      slot.style.width = `${opts.base * s}px`;
      slot.style.setProperty("--scale", s.toFixed(4));
    }
  };

  const tick = (now: number) => {
    const dt = last ? Math.min(now - last, 64) : 16;
    last = now;
    const k = 1 - Math.exp(-dt / opts.smoothingMs);
    let moving = false;
    for (let i = 0; i < slots.length; i++) {
      const diff = target[i] - current[i];
      if (Math.abs(diff) < 0.001) {
        current[i] = target[i];
      } else {
        current[i] += diff * k;
        moving = true;
      }
    }
    write();
    if (moving) {
      frame = requestAnimationFrame(tick);
    } else {
      frame = 0;
      last = 0;
    }
  };

  const kick = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };

  return {
    setSlots(next) {
      slots = next;
      current = next.map((_, i) => current[i] ?? 1);
      target = next.map((_, i) => target[i] ?? 1);
      write();
    },
    move(clientX) {
      // Grup sola yaslı: kabın sol kenarı büyümeyle kaymaz. İmleç ve dikdörtgen
      // ekran (zoom'lu) pikseli; ikon ölçüleri CSS pikseli → boyut ayarına böl (7.9).
      const zoom = container.currentCSSZoom || 1;
      const x = (clientX - container.getBoundingClientRect().left) / zoom;
      const f = focusForCursor(x, slots.length, opts);
      const step = opts.base + opts.gap;
      for (let i = 0; i < slots.length; i++) {
        const restCenter = i * step + opts.base / 2;
        target[i] = magnifyScale(restCenter - f, opts.max, opts.range);
      }
      kick();
    },
    leave() {
      target = target.map(() => 1);
      kick();
    },
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
