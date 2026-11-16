import type { Config } from "./ipc";

/**
 * Config'teki temayı :root değişkenlerine yazar (tokens.css).
 *
 * İki ayrı opaklık:
 * - `--glass-opacity` (ayarlardaki saydamlık): cam katmanlarının tamamı. 1 = tam
 *   buzlu cam, düştükçe arkadaki gerçek masaüstü görünür.
 * - `--glass-alpha` (otomatik): bulanık duvar kâğıdının üstündeki koyu örtü,
 *   şeridin parlaklığına (`luma`, 0–1, 7.2) göre. Plan `0.45 + 0.30 · luma`;
 *   beyaz duvar kâğıdında `--text-2` böyle 4.4:1 kalıyor (hedef ≥ 4.5:1),
 *   0.35 ile 5.0:1 (`--text` 9.1:1).
 * Duvar kâğıdı şeridi yoksa (luma yok) örtü tam, saydamlığı yalnızca ayar belirler.
 */
export function applyTheme(theme: Config["theme"], luma?: number) {
  const root = document.documentElement.style;
  const opacity = Math.min(Math.max(theme.opacity, 0.1), 1);
  const alpha = luma === undefined ? 1 : 0.45 + 0.35 * Math.min(Math.max(luma, 0), 1);
  root.setProperty("--accent", theme.accent);
  root.setProperty("--glass-opacity", opacity.toFixed(3));
  root.setProperty("--glass-alpha", alpha.toFixed(3));
  root.setProperty("--r-bar", `${Math.max(theme.radius, 0)}px`);
}
