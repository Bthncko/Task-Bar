import type { WorldCity } from "../../lib/ipc";
import type { WidgetDefinition } from "../types";
import { WorldClockBar } from "./Bar";
import { WorldClockSettings } from "./Settings";
import { t } from "../../lib/i18n";

export interface WorldClockConfig {
  cities: WorldCity[];
}

export const worldClockWidget: WidgetDefinition<WorldClockConfig> = {
  id: "worldClock",
  get name() {
    return t("Dünya saati");
  },
  category: "info",
  get description() {
    return t("Seçtiğin şehirlerin saati.");
  },
  defaultSection: "center",
  Bar: WorldClockBar,
  defaultConfig: {
    cities: [
      { label: "Londra", tz: "Europe/London" },
      { label: "New York", tz: "America/New_York" },
    ],
  },
  Settings: WorldClockSettings,
};
