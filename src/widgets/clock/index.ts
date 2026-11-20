import type { WidgetDefinition } from "../types";
import { CalendarPopup } from "../calendar/Popup";
import { ClockBar } from "./Bar";
import { t } from "../../lib/i18n";

export interface ClockConfig {
  showSeconds: boolean;
}

// Saate tıklayınca takvim açılır (bölüm 6.1). Takvimin kendi ayarları
// (ICS adresleri) config.widgets.calendar'da; panel onları kendisi okur.
export const clockWidget: WidgetDefinition<ClockConfig> = {
  id: "clock",
  get name() {
    return t("Saat");
  },
  category: "info",
  get description() {
    return t("Saat ve tarih; tıklayınca takvim ve etkinlikler.");
  },
  defaultSection: "center",
  Bar: ClockBar,
  Popup: CalendarPopup,
  popupSize: { width: 620, height: 380 },
  defaultConfig: { showSeconds: false },
};
