import type { WidgetDefinition } from "../types";
import { BatteryBar } from "./Bar";

export const batteryWidget: WidgetDefinition<Record<string, never>> = {
  id: "battery",
  name: "Pil",
  Bar: BatteryBar,
  defaultConfig: {},
};
