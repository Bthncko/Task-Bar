import type { WidgetDefinition } from "./types";
import { appsWidget } from "./apps";
import { clockWidget } from "./clock";
import { startWidget } from "./start";

// Yeni widget = yeni klasör + buraya bir satır.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const registry: Record<string, WidgetDefinition<any>> = {
  [startWidget.id]: startWidget,
  [appsWidget.id]: appsWidget,
  [clockWidget.id]: clockWidget,
};
