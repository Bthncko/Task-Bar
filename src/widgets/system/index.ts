import type { SystemButton } from "../../lib/ipc";
import type { WidgetDefinition } from "../types";
import { SystemBar } from "./Bar";
import { SystemSettings } from "./Settings";
import { TrayPopup } from "./TrayPopup";

export interface SystemConfig {
  buttons: SystemButton[];
}

export const systemWidget: WidgetDefinition<SystemConfig> = {
  id: "system",
  name: "Sistem düğmeleri",
  category: "system",
  description: "Bildirim merkezi, hızlı ayarlar, arama gibi Windows panellerini açar.",
  defaultSection: "right",
  Bar: SystemBar,
  // Tek panel: tepsi ("system/tray").
  Popup: TrayPopup,
  popupSize: { width: 272, height: 236 },
  defaultConfig: { buttons: ["tray", "notifications", "quickSettings"] },
  Settings: SystemSettings,
};
