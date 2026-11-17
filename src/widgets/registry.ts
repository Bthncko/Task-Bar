import type { WidgetDefinition } from "./types";
import { appsWidget } from "./apps";
import { batteryWidget } from "./battery";
import { clockWidget } from "./clock";
import { mediaWidget } from "./media";
import { radiosWidget } from "./radios";
import { startWidget } from "./start";
import { systemWidget } from "./system";
import { volumeWidget } from "./volume";
import { weatherWidget } from "./weather";

// Yeni widget = yeni klasör + buraya bir satır.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const registry: Record<string, WidgetDefinition<any>> = {
  [startWidget.id]: startWidget,
  [appsWidget.id]: appsWidget,
  [mediaWidget.id]: mediaWidget,
  [weatherWidget.id]: weatherWidget,
  [clockWidget.id]: clockWidget,
  [radiosWidget.id]: radiosWidget,
  [volumeWidget.id]: volumeWidget,
  [batteryWidget.id]: batteryWidget,
  [systemWidget.id]: systemWidget,
};
