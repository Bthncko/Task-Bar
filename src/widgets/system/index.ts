import type { SystemButton } from "../../lib/ipc";
import type { WidgetDefinition } from "../types";
import { SystemBar } from "./Bar";
import { SystemSettings } from "./Settings";

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
  defaultConfig: { buttons: ["tray", "notifications", "quickSettings"] },
  Settings: SystemSettings,
};
