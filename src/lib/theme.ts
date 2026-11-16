import type { Config } from "./ipc";

/** Config'teki temayı :root değişkenlerine yazar (tokens.css). */
export function applyTheme(theme: Config["theme"]) {
  const root = document.documentElement.style;
  const alpha = Math.min(Math.max(theme.opacity, 0.1), 1);
  root.setProperty("--accent", theme.accent);
  // Cam katmanının opaklığı. 7.2'de duvar kâğıdı parlaklığına göre Rust da günceller.
  root.setProperty("--glass-alpha", String(alpha));
  root.setProperty("--r-bar", `${Math.max(theme.radius, 0)}px`);
}
