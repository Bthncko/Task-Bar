import type { WidgetDefinition } from "../types";
import { RecycleBar } from "./Bar";

export const recycleBinWidget: WidgetDefinition<Record<string, never>> = {
  id: "recycleBin",
  name: "Geri dönüşüm kutusu",
  category: "tools",
  description:
    "Öğe sayısı; dosya sürükleyip bırakınca çöpe atar. Tıklayınca açılır, sağ tıkla (onay sorarak) boşaltılır.",
  defaultSection: "right",
  Bar: RecycleBar,
  defaultConfig: {},
};
