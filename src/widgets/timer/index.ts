import type { WidgetDefinition } from "../types";
import { TimerBar } from "./Bar";
import { TimerPopup } from "./Popup";

export const timerWidget: WidgetDefinition<Record<string, never>> = {
  id: "timer",
  name: "Zamanlayıcı",
  category: "tools",
  description: "Geri sayım / pomodoro; bitince bildirim ve ses.",
  defaultSection: "right",
  Bar: TimerBar,
  Popup: TimerPopup,
  popupSize: { width: 300, height: 250 },
  defaultConfig: {},
};
