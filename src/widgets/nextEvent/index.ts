import type { WidgetDefinition } from "../types";
import { NextEventBar } from "./Bar";

export const nextEventWidget: WidgetDefinition<Record<string, never>> = {
  id: "nextEvent",
  name: "Sıradaki etkinlik",
  category: "info",
  description:
    "Takvimdeki sıradaki etkinlik ve kalan süre; 10 dk kala vurgulanır. Etkinlik yoksa gizlenir.",
  defaultSection: "center",
  Bar: NextEventBar,
  defaultConfig: {},
};
