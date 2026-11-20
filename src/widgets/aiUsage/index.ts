import type { WidgetDefinition } from "../types";
import { AiUsageBar } from "./Bar";
import { AiUsagePopup } from "./Popup";
import { t } from "../../lib/i18n";

export const aiUsageWidget: WidgetDefinition<Record<string, never>> = {
  id: "aiUsage",
  get name() {
    return t("AI kullanımı");
  },
  category: "info",
  get description() {
    return t(
      "Claude limitlerin: oturum (5 saat) ve haftalık yüzde, ne zaman sıfırlanacağıyla (/usage ile aynı).",
    );
  },
  defaultSection: "right",
  Bar: AiUsageBar,
  Popup: AiUsagePopup,
  popupSize: { width: 340, height: 560 },
  defaultConfig: {},
};
