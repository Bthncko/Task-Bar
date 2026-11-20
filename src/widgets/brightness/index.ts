import type { WidgetDefinition } from "../types";
import { BrightnessBar } from "./Bar";
import { BrightnessPopup } from "./Popup";
import { t } from "../../lib/i18n";

export const brightnessWidget: WidgetDefinition<Record<string, never>> = {
  id: "brightness",
  get name() {
    return t("Parlaklık");
  },
  category: "system",
  get description() {
    return t(
      "Dizüstü ekranının parlaklığı; tekerlekle ya da panelden ayarlanır. Harici monitörde desteklenmiyor.",
    );
  },
  defaultSection: "right",
  Bar: BrightnessBar,
  Popup: BrightnessPopup,
  popupSize: { width: 300, height: 120 },
  defaultConfig: {},
};
