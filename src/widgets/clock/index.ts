import type { WidgetDefinition } from "../types";
import { CalendarPopup } from "../calendar/Popup";
import { ClockBar } from "./Bar";

export interface ClockConfig {
  showSeconds: boolean;
}

// Saate tıklayınca takvim açılır (bölüm 6.1). Takvimin kendi ayarları
// (ICS adresleri) config.widgets.calendar'da; panel onları kendisi okur.
export const clockWidget: WidgetDefinition<ClockConfig> = {
  id: "clock",
  name: "Saat",
  Bar: ClockBar,
  Popup: CalendarPopup,
  popupSize: { width: 320, height: 510 },
  defaultConfig: { showSeconds: false },
};
