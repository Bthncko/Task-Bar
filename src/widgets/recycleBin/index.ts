import type { WidgetDefinition } from "../types";
import { RecycleBar } from "./Bar";
import { t } from "../../lib/i18n";

export const recycleBinWidget: WidgetDefinition<Record<string, never>> = {
  id: "recycleBin",
  get name() {
    return t("Geri dönüşüm kutusu");
  },
  category: "tools",
  get description() {
    return t(
      "Öğe sayısı; dosya sürükleyip bırakınca çöpe atar. Tıklayınca açılır, sağ tıkla (onay sorarak) boşaltılır.",
    );
  },
  defaultSection: "right",
  Bar: RecycleBar,
  defaultConfig: {},
};
