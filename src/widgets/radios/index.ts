import type { WidgetDefinition } from "../types";
import { RadiosBar } from "./Bar";

export const radiosWidget: WidgetDefinition<Record<string, never>> = {
  id: "radios",
  name: "Wi-Fi / Bluetooth",
  Bar: RadiosBar,
  defaultConfig: {},
};
