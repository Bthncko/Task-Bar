import type { Config } from "./ipc";

/** Config'teki temayı :root değişkenlerine yazar (bölüm 10). */
export function applyTheme(theme: Config["theme"]) {
  const root = document.documentElement.style;
  const opacity = Math.min(Math.max(theme.opacity, 0.1), 1);
  root.setProperty("--accent", theme.accent);
  root.setProperty("--bar-bg", `rgba(18, 20, 26, ${opacity})`);
  root.setProperty("--radius", `${Math.max(theme.radius, 0)}px`);
}
