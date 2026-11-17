import type { WidgetDefinition } from "../types";
import { RadiosBar } from "./Bar";

export const radiosWidget: WidgetDefinition<Record<string, never>> = {
  id: "radios",
  name: "Wi-Fi / Bluetooth",
  category: "system",
  description: "Wi-Fi ve Bluetooth aç/kapat, Windows paneline kısayol.",
  defaultSection: "right",
  Bar: RadiosBar,
  defaultConfig: {},
};
