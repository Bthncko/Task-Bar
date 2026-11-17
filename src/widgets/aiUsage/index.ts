import type { WidgetDefinition } from "../types";
import { AiUsageBar } from "./Bar";
import { AiUsagePopup } from "./Popup";

export const aiUsageWidget: WidgetDefinition<Record<string, never>> = {
  id: "aiUsage",
  name: "AI kullanımı",
  category: "info",
  description:
    "Claude limitlerin: oturum (5 saat) ve haftalık yüzde, ne zaman sıfırlanacağıyla (/usage ile aynı).",
  defaultSection: "right",
  Bar: AiUsageBar,
  Popup: AiUsagePopup,
  popupSize: { width: 340, height: 560 },
  defaultConfig: {},
};
