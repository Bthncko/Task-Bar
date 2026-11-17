import type { SysmonView } from "../../lib/ipc";
import type { WidgetDefinition } from "../types";
import { SysmonBar } from "./Bar";
import { SysmonPopup } from "./Popup";
import { SysmonSettings } from "./Settings";

export interface SysmonConfig {
  view: SysmonView;
}

export const sysmonWidget: WidgetDefinition<SysmonConfig> = {
  id: "sysmon",
  name: "Sistem izleyici",
  category: "system",
  description: "İşlemci, bellek ve ağ kullanımı; tıklayınca diskler ve süreçler.",
  defaultSection: "right",
  Bar: SysmonBar,
  Popup: SysmonPopup,
  popupSize: { width: 340, height: 480 },
  defaultConfig: { view: "compact" },
  Settings: SysmonSettings,
};
