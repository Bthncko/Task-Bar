import type { WidgetDefinition } from "../types";
import { BatteryBar } from "./Bar";
import { BatteryPopup } from "./Popup";
import { t } from "../../lib/i18n";

export const batteryWidget: WidgetDefinition<Record<string, never>> = {
  id: "battery",
  get name() {
    return t("Pil");
  },
  category: "system",
  get description() {
    return t("Pil yüzdesi; tıklayınca enerji tasarrufu, güç modu, parlaklık ve ekran ayarları.");
  },
  defaultSection: "right",
  Bar: BatteryBar,
  Popup: BatteryPopup,
  popupSize: { width: 320, height: 520 },
  defaultConfig: {},
};
