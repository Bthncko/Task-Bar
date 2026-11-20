import type { WidgetDefinition } from "../types";
import { RadiosBar } from "./Bar";
import { RadiosPopup } from "./Popup";
import { t } from "../../lib/i18n";

export const radiosWidget: WidgetDefinition<Record<string, never>> = {
  id: "radios",
  get name() {
    return t("Wi-Fi / Bluetooth");
  },
  category: "system",
  get description() {
    return t("Wi-Fi ve Bluetooth aç/kapat; oka basınca ağlar ve aygıtlar.");
  },
  defaultSection: "right",
  Bar: RadiosBar,
  Popup: RadiosPopup,
  popupSize: (page) =>
    page === "bluetooth" ? { width: 320, height: 340 } : { width: 340, height: 440 },
  defaultConfig: {},
};
