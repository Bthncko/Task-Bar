import type { WidgetDefinition } from "../types";
import { ClockBar } from "./Bar";

export const clockWidget: WidgetDefinition<Record<string, never>> = {
  id: "clock",
  name: "Saat",
  Bar: ClockBar,
  defaultConfig: {},
};
