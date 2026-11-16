import type { WidgetDefinition } from "../types";
import { VolumeBar } from "./Bar";

export const volumeWidget: WidgetDefinition<Record<string, never>> = {
  id: "volume",
  name: "Ses",
  Bar: VolumeBar,
  defaultConfig: {},
};
