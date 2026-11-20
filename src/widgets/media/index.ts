import type { WidgetDefinition } from "../types";
import { MediaBar } from "./Bar";
import { MediaPopup } from "./Popup";
import { t } from "../../lib/i18n";

export const mediaWidget: WidgetDefinition<Record<string, never>> = {
  id: "media",
  get name() {
    return t("Müzik");
  },
  category: "media",
  get description() {
    return t(
      "Çalan şarkı ve kontroller; tıklayınca müzik paneli (Spotify: sıra, arama, ses, cihaz). Karonun üstünde tekerlek Spotify sesini değiştirir.",
    );
  },
  defaultSection: "center",
  Bar: MediaBar,
  Popup: MediaPopup,
  popupSize: { width: 380, height: 640 },
  defaultConfig: {},
};
