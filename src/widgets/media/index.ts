import type { WidgetDefinition } from "../types";
import { MediaBar } from "./Bar";

export const mediaWidget: WidgetDefinition<Record<string, never>> = {
  id: "media",
  name: "Müzik",
  Bar: MediaBar,
  defaultConfig: {},
};
