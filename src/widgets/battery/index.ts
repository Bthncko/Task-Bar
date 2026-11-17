import type { WidgetDefinition } from "../types";
import { BatteryBar } from "./Bar";

export const batteryWidget: WidgetDefinition<Record<string, never>> = {
  id: "battery",
  name: "Pil",
  category: "system",
  description: "Pil yüzdesi ve şarj durumu.",
  defaultSection: "right",
  Bar: BatteryBar,
  defaultConfig: {},
};
