import type { WidgetDefinition } from "../types";
import { StartBar } from "./Bar";
import { t } from "../../lib/i18n";

export const startWidget: WidgetDefinition<Record<string, never>> = {
  id: "start",
  get name() {
    return t("Başlat");
  },
  category: "core",
  get description() {
    return t("Windows Başlat menüsünü açar.");
  },
  defaultSection: "left",
  Bar: StartBar,
  defaultConfig: {},
};
