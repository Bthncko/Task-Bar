import type { Config } from "./ipc";

/** `accent: "auto"` iken Windows rengi okunamazsa. tokens.css ile aynı. */
export const FALLBACK_ACCENT = "#3b9eff";
/** "Sistem" yazı tipi: Windows 11'in arayüz yazısı. */
const SYSTEM_FONT = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';

/** Tema vurgu rengi: "auto" ise Windows'unki (7.9). */
export function resolveAccent(theme: Config["theme"], systemAccent?: string | null) {
  return theme.accent === "auto" ? (systemAccent ?? FALLBACK_ACCENT) : theme.accent;
}

/** Boyut ayarı, sınırlar içinde (Rust → `Theme::ui_scale` ile aynı). */
export function uiScale(theme: Config["theme"]) {
  return Number.isFinite(theme.scale) ? Math.min(Math.max(theme.scale, 0.85), 1.25) : 1;
}

type Options = {
  /** Duvar kâğıdı şeridinin parlaklığı (0–1); yoksa (düz cam) örtü tam. */
  luma?: number;
  systemAccent?: string | null;
  /** Bu pencerenin tamamı boyut ayarıyla ölçeklensin mi (yalnızca dock). */
  zoomDocument?: boolean;
};

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
 *
 * 7.9: yazı tipi, hareket ayarı (`data-motion`, global.css) ve dock'ta boyut (zoom).
 */
export function applyTheme(theme: Config["theme"], options: Options = {}) {
  const { luma, systemAccent, zoomDocument } = options;
  const html = document.documentElement;
  const root = html.style;
  const opacity = Math.min(Math.max(theme.opacity, 0.1), 1);
  const alpha = luma === undefined ? 1 : 0.45 + 0.35 * Math.min(Math.max(luma, 0), 1);
  root.setProperty("--accent", resolveAccent(theme, systemAccent));
  root.setProperty("--glass-opacity", opacity.toFixed(3));
  root.setProperty("--glass-alpha", alpha.toFixed(3));
  root.setProperty("--r-bar", `${Math.max(theme.radius, 0)}px`);
  if (theme.font === "system") root.setProperty("--font", SYSTEM_FONT);
  else root.removeProperty("--font");
  html.dataset.motion = theme.reduceMotion ?? "system";
  if (zoomDocument) root.zoom = String(uiScale(theme));
}
