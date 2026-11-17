import type { WidgetDefinition } from "../types";
import { StartBar } from "./Bar";

export const startWidget: WidgetDefinition<Record<string, never>> = {
  id: "start",
  name: "Başlat",
  category: "core",
  description: "Windows Başlat menüsünü açar.",
  defaultSection: "left",
  Bar: StartBar,
  defaultConfig: {},
};
