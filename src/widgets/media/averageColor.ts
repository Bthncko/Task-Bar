import type { Rgb } from "../../lib/color";

/**
 * Kapağın baskın rengi (7.5): 16×16 örnekte pikseller kaba renk kutularına
 * ayrılır, doygun pikseller daha ağır sayılır; en ağır kutunun ortalaması.
 * Griye yakın kapakta düz ortalamaya döner.
 */
export function dominantColor(src: string): Promise<Rgb | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = 16;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        const buckets = new Map<number, { w: number; r: number; g: number; b: number }>();
        const avg = [0, 0, 0];
        for (let i = 0; i < data.length; i += 4) {
          const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
          avg[0] += r;
          avg[1] += g;
          avg[2] += b;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          // Çok koyu ve çok açık pikseller rengi taşımaz.
          if (max < 40 || min > 225) continue;
          const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
          const w = 0.15 + sat * sat;
          const e = buckets.get(key) ?? { w: 0, r: 0, g: 0, b: 0 };
          e.w += w;
          e.r += r * w;
          e.g += g * w;
          e.b += b * w;
          buckets.set(key, e);
        }

        let best: { w: number; r: number; g: number; b: number } | null = null;
        for (const e of buckets.values()) if (!best || e.w > best.w) best = e;
        const n = data.length / 4;
        resolve(
          best && best.w > 2
            ? ([best.r / best.w, best.g / best.w, best.b / best.w].map(Math.round) as Rgb)
            : (avg.map((v) => Math.round(v / n)) as Rgb),
        );
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
