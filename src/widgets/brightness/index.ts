import type { WidgetDefinition } from "../types";
import { BrightnessBar } from "./Bar";
import { BrightnessPopup } from "./Popup";

export const brightnessWidget: WidgetDefinition<Record<string, never>> = {
  id: "brightness",
  name: "Parlaklık",
  category: "system",
  description:
    "Dizüstü ekranının parlaklığı; tekerlekle ya da panelden ayarlanır. Harici monitörde desteklenmiyor.",
  defaultSection: "right",
  Bar: BrightnessBar,
  Popup: BrightnessPopup,
  popupSize: { width: 300, height: 120 },
  defaultConfig: {},
};
