import type { WidgetDefinition } from "../types";
import { MediaBar } from "./Bar";
import { MediaPopup } from "./Popup";

export const mediaWidget: WidgetDefinition<Record<string, never>> = {
  id: "media",
  name: "Müzik",
  Bar: MediaBar,
  Popup: MediaPopup,
  popupSize: { width: 360, height: 520 },
  defaultConfig: {},
};
