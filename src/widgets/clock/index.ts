import type { WidgetDefinition } from "../types";
import { CalendarPopup } from "../calendar/Popup";
import { ClockBar } from "./Bar";

// Saate tıklayınca takvim açılır (bölüm 6.1). Takvimin kendi ayarları
// (ICS adresleri) config.widgets.calendar'da; panel onları kendisi okur.
export const clockWidget: WidgetDefinition<Record<string, never>> = {
  id: "clock",
  name: "Saat",
  Bar: ClockBar,
  Popup: CalendarPopup,
  popupSize: { width: 320, height: 510 },
  defaultConfig: {},
};
