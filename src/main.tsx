import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import "./styles/global.css";
import { DockWindow } from "./windows/DockWindow";
import { PopupWindow } from "./windows/PopupWindow";
import { SettingsWindow } from "./windows/SettingsWindow";

// Her Tauri penceresi aynı paketi yükler; hangisi olduğunu hash söyler.
function pickWindow() {
  const hash = window.location.hash;
  if (hash.startsWith("#/popup/")) {
    return <PopupWindow widgetId={hash.slice("#/popup/".length)} />;
  }
  if (hash === "#/settings") return <SettingsWindow />;
  return <DockWindow />;
}

// Tarayıcı sağ tık menüsü kapalı (bölüm 10).
window.addEventListener("contextmenu", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{pickWindow()}</React.StrictMode>,
);
