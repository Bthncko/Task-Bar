import type { WidgetDefinition } from "../types";
import { VolumeBar } from "./Bar";

export const volumeWidget: WidgetDefinition<Record<string, never>> = {
  id: "volume",
  name: "Ses",
  category: "system",
  description: "Ses seviyesi; sürükle ya da tekerlekle ayarla.",
  defaultSection: "right",
  Bar: VolumeBar,
  defaultConfig: {},
};
