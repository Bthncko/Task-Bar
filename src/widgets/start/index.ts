import type { WidgetDefinition } from "../types";
import { StartBar } from "./Bar";

export const startWidget: WidgetDefinition<Record<string, never>> = {
  id: "start",
  name: "Başlat",
  Bar: StartBar,
  defaultConfig: {},
};
