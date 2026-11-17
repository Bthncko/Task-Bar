import type { WidgetDefinition } from "../types";
import { VolumeBar } from "./Bar";
import { VolumePopup } from "./Popup";

export const volumeWidget: WidgetDefinition<Record<string, never>> = {
  id: "volume",
  name: "Ses",
  category: "system",
  description: "Ses seviyesi; tıklayınca çıkış aygıtı ve mikrofon.",
  defaultSection: "right",
  Bar: VolumeBar,
  Popup: VolumePopup,
  popupSize: { width: 320, height: 340 },
  defaultConfig: {},
};
