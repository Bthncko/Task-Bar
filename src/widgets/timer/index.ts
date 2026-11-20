import type { WidgetDefinition } from "../types";
import { TimerBar } from "./Bar";
import { TimerPopup } from "./Popup";
import { t } from "../../lib/i18n";

export const timerWidget: WidgetDefinition<Record<string, never>> = {
  id: "timer",
  get name() {
    return t("Zamanlayıcı");
  },
  category: "tools",
  get description() {
    return t("Geri sayım / pomodoro; bitince bildirim ve ses.");
  },
  defaultSection: "right",
  Bar: TimerBar,
  Popup: TimerPopup,
  popupSize: { width: 300, height: 250 },
  defaultConfig: {},
};
