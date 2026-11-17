import type { WidgetDefinition } from "./types";
import { appsWidget } from "./apps";
import { batteryWidget } from "./battery";
import { brightnessWidget } from "./brightness";
import { clockWidget } from "./clock";
import { keyboardWidget } from "./keyboard";
import { mediaWidget } from "./media";
import { micWidget } from "./mic";
import { nextEventWidget } from "./nextEvent";
import { radiosWidget } from "./radios";
import { recycleBinWidget } from "./recycleBin";
import { startWidget } from "./start";
import { sysmonWidget } from "./sysmon";
import { systemWidget } from "./system";
import { timerWidget } from "./timer";
import { volumeWidget } from "./volume";
import { weatherWidget } from "./weather";
import { worldClockWidget } from "./worldClock";
import { aiUsageWidget } from "./aiUsage";

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
  [micWidget.id]: micWidget,
  [batteryWidget.id]: batteryWidget,
  [systemWidget.id]: systemWidget,
  [sysmonWidget.id]: sysmonWidget,
  // 8.8 küçük widget'lar (varsayılan olarak yerleşimde değil).
  [timerWidget.id]: timerWidget,
  [nextEventWidget.id]: nextEventWidget,
  [worldClockWidget.id]: worldClockWidget,
  [recycleBinWidget.id]: recycleBinWidget,
  [brightnessWidget.id]: brightnessWidget,
  [keyboardWidget.id]: keyboardWidget,
  // 8.9
  [aiUsageWidget.id]: aiUsageWidget,
};
