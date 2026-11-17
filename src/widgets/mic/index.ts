import type { WidgetDefinition } from "../types";
import { MicBar } from "./Bar";

export const micWidget: WidgetDefinition<Record<string, never>> = {
  id: "mic",
  name: "Mikrofon",
  category: "system",
  description: "Mikrofonu tek tıkla kapat / aç; kapalıyken kırmızı.",
  defaultSection: "right",
  Bar: MicBar,
  defaultConfig: {},
};
