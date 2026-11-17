import type { WidgetDefinition } from "../types";
import { MediaBar } from "./Bar";
import { MediaPopup } from "./Popup";

export const mediaWidget: WidgetDefinition<Record<string, never>> = {
  id: "media",
  name: "Müzik",
  category: "media",
  description: "Çalan şarkı ve kontroller; tıklayınca sıradakiler paneli.",
  defaultSection: "center",
  Bar: MediaBar,
  Popup: MediaPopup,
  popupSize: { width: 360, height: 520 },
  defaultConfig: {},
};
