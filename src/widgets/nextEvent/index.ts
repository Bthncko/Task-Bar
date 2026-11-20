import type { WidgetDefinition } from "../types";
import { NextEventBar } from "./Bar";
import { t } from "../../lib/i18n";

export const nextEventWidget: WidgetDefinition<Record<string, never>> = {
  id: "nextEvent",
  get name() {
    return t("Sıradaki etkinlik");
  },
  category: "info",
  get description() {
    return t(
      "Takvimdeki sıradaki etkinlik ve kalan süre; 10 dk kala vurgulanır. Etkinlik yoksa gizlenir.",
    );
  },
  defaultSection: "center",
  Bar: NextEventBar,
  defaultConfig: {},
};
