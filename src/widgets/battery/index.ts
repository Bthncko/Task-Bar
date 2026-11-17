import type { WidgetDefinition } from "../types";
import { BatteryBar } from "./Bar";
import { BatteryPopup } from "./Popup";

export const batteryWidget: WidgetDefinition<Record<string, never>> = {
  id: "battery",
  name: "Pil",
  category: "system",
  description: "Pil yüzdesi; tıklayınca enerji tasarrufu, güç modu, parlaklık ve ekran ayarları.",
  defaultSection: "right",
  Bar: BatteryBar,
  Popup: BatteryPopup,
  popupSize: { width: 320, height: 520 },
  defaultConfig: {},
};
