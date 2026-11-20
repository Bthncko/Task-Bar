import type { ReactNode } from "react";
import { useLang } from "./i18n";

/**
 * Pencere kökü: dil değişince tüm pencere yeniden çizilir (metinler `t()` ile
 * render'da çevrilir). `render` her seferinde yeni öğe ürettiği için alt ağaç
 * bellekte kalan eski çeviriyle takılmaz.
 */
export function LangRoot({ render }: { render: () => ReactNode }) {
  useLang();
  return render();
}
