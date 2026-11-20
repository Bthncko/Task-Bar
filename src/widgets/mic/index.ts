import type { WidgetDefinition } from "../types";
import { MicBar } from "./Bar";
import { t } from "../../lib/i18n";

export const micWidget: WidgetDefinition<Record<string, never>> = {
  id: "mic",
  get name() {
    return t("Mikrofon");
  },
  category: "system",
  get description() {
    return t("Mikrofonu tek tıkla kapat / aç; kapalıyken kırmızı.");
  },
  defaultSection: "right",
  Bar: MicBar,
  defaultConfig: {},
};
