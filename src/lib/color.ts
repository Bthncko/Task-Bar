// Renkli karolar (müzik, hava) için renk yardımcıları (7.5).

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbCss = ([r, g, b]: Rgb) => `rgb(${r} ${g} ${b})`;

/** WCAG göreli parlaklık. */
export function luminance([r, g, b]: Rgb) {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Beyaz metnin bu zemindeki kontrastı. */
export const contrastWithWhite = (c: Rgb) => 1.05 / (luminance(c) + 0.05);

export function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rr
      ? (gg - bb) / d + (gg < bb ? 6 : 0)
      : max === gg
        ? (bb - rr) / d + 2
        : (rr - gg) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb([h, s, l]: [number, number, number]): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as Rgb;
}

/** `tinted` karo degradesinin en açık ucu: renk %92 + beyaz %8 (ui.module.css). */
const lightestStop = ([r, g, b]: Rgb): Rgb => [r, g, b].map((v) => v * 0.92 + 255 * 0.08) as Rgb;

/**
 * Rengi, `tinted` karonun en açık yerinde beyaz metin en az 4.5:1 okunacak
 * kadar koyulaştırır (ton aynı kalır). Zaten koyuysa dokunmaz.
 */
export function readableTint(color: Rgb, minContrast = 4.5): Rgb {
  const [h, s] = rgbToHsl(color);
  let l = rgbToHsl(color)[2];
  let out = color;
  while (contrastWithWhite(lightestStop(out)) < minContrast && l > 0.05) {
    l -= 0.01;
    out = hslToRgb([h, s, l]);
  }
  return out;
}

/** Kapak rengi: doygunluğu biraz artır, griye yakın ya da çok koyu kalmasın. */
export function vivid(color: Rgb): Rgb {
  const [h, s, l] = rgbToHsl(color);
  return hslToRgb([h, Math.min(1, s * 1.25 + 0.05), Math.max(l, 0.22)]);
}
