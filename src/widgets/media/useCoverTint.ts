import { useEffect, useState } from "react";
import { readableTint, rgbCss, vivid } from "../../lib/color";
import { dominantColor } from "./averageColor";

/** Kapak yokken / rengi hesaplanırken: koyu, nötr mavi-gri. */
export const FALLBACK_TINT = "rgb(58 62 76)";

/**
 * Kapağın baskın rengi, üstünde beyaz yazı okunacak kadar koyulaştırılmış (7.5).
 * Karo ve müzik paneli aynı rengi kullanır.
 */
export function useCoverTint(artwork: string | null) {
  // Hangi kapak için hesaplandığıyla birlikte tut: kapak değişince eski ton kullanılmaz.
  const [computed, setComputed] = useState<{ art: string; tint: string } | null>(null);

  useEffect(() => {
    if (!artwork) return;
    let alive = true;
    dominantColor(artwork).then((c) => {
      if (alive && c) setComputed({ art: artwork, tint: rgbCss(readableTint(vivid(c))) });
    });
    return () => {
      alive = false;
    };
  }, [artwork]);

  return computed && computed.art === artwork ? computed.tint : FALLBACK_TINT;
}
