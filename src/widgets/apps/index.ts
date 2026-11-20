import type { WidgetDefinition } from "../types";
import { AppsBar } from "./Bar";
import { t } from "../../lib/i18n";

export interface AppsConfig {
  magnify: number;
  previews: boolean;
  previewDelayMs: number;
}

export const appsWidget: WidgetDefinition<AppsConfig> = {
  id: "apps",
  get name() {
    return t("Uygulamalar");
  },
  category: "core",
  get description() {
    return t("Sabitlenen ve açık uygulamalar; üzerine gelince büyür.");
  },
  defaultSection: "left",
  Bar: AppsBar,
  defaultConfig: { magnify: 1.8, previews: true, previewDelayMs: 350 },
};
