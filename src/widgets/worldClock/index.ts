import type { WorldCity } from "../../lib/ipc";
import type { WidgetDefinition } from "../types";
import { WorldClockBar } from "./Bar";
import { WorldClockSettings } from "./Settings";

export interface WorldClockConfig {
  cities: WorldCity[];
}

export const worldClockWidget: WidgetDefinition<WorldClockConfig> = {
  id: "worldClock",
  name: "Dünya saati",
  category: "info",
  description: "Seçtiğin şehirlerin saati.",
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
