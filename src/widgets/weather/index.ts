import type { WidgetDefinition } from "../types";
import { WeatherBar } from "./Bar";
import { WeatherPopup } from "./Popup";
import { t } from "../../lib/i18n";

export interface WeatherConfig {
  lat: number;
  lon: number;
  city: string;
  unit: "C" | "F";
}

export const weatherWidget: WidgetDefinition<WeatherConfig> = {
  id: "weather",
  get name() {
    return t("Hava durumu");
  },
  category: "info",
  get description() {
    return t("Anlık hava; tıklayınca saatlik ve 7 günlük tahmin.");
  },
  defaultSection: "center",
  Bar: WeatherBar,
  Popup: WeatherPopup,
  popupSize: { width: 340, height: 500 },
  defaultConfig: { lat: 41.01, lon: 28.98, city: "İstanbul", unit: "C" },
};
