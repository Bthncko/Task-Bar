import type { WidgetDefinition } from "../types";
import { AppsBar } from "./Bar";

export interface AppsConfig {
  magnify: number;
}

export const appsWidget: WidgetDefinition<AppsConfig> = {
  id: "apps",
  name: "Uygulamalar",
  category: "core",
  description: "Sabitlenen ve açık uygulamalar; üzerine gelince büyür.",
  defaultSection: "left",
  Bar: AppsBar,
  defaultConfig: { magnify: 1.8 },
};
