import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles/tokens.css";
import "./styles/global.css";
import { DockWindow } from "./windows/DockWindow";
import { PopupWindow } from "./windows/PopupWindow";
import { SettingsWindow } from "./windows/SettingsWindow";

// Her Tauri penceresi aynı paketi yükler; hangisi olduğunu pencere etiketi söyler
// (tauri.conf.json). Etiket adresten güvenilir: pencere adresine # eklemeye gerek yok.
function pickWindow() {
  switch (getCurrentWindow().label) {
    case "popup":
      return <PopupWindow />;
    case "settings":
      return <SettingsWindow />;
    default:
      return <DockWindow />;
  }
}

// Tarayıcı sağ tık menüsü kapalı (bölüm 10).
window.addEventListener("contextmenu", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{pickWindow()}</React.StrictMode>,
);
