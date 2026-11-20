import type { WidgetDefinition } from "../types";
import { VolumeBar } from "./Bar";
import { VolumePopup } from "./Popup";
import { t } from "../../lib/i18n";

export const volumeWidget: WidgetDefinition<Record<string, never>> = {
  id: "volume",
  get name() {
    return t("Ses");
  },
  category: "system",
  get description() {
    return t("Ses seviyesi; tıklayınca çıkış aygıtı ve mikrofon.");
  },
  defaultSection: "right",
  Bar: VolumeBar,
  Popup: VolumePopup,
  popupSize: { width: 320, height: 340 },
  defaultConfig: {},
};
