import type { WidgetDefinition } from "../types";
import { RadiosBar } from "./Bar";
import { RadiosPopup } from "./Popup";

export const radiosWidget: WidgetDefinition<Record<string, never>> = {
  id: "radios",
  name: "Wi-Fi / Bluetooth",
  category: "system",
  description: "Wi-Fi ve Bluetooth aç/kapat; oka basınca ağlar ve aygıtlar.",
  defaultSection: "right",
  Bar: RadiosBar,
  Popup: RadiosPopup,
  popupSize: (page) =>
    page === "bluetooth" ? { width: 320, height: 340 } : { width: 340, height: 440 },
  defaultConfig: {},
};
